import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import "./App.css";

const API = "http://localhost:5000";

export default function App() {
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [text, setText] = useState("");
  const [media, setMedia] = useState("");
  const [privacy, setPrivacy] = useState("public");
  const [commentText, setCommentText] = useState({});
  const [friendMessage, setFriendMessage] = useState("");

  const socketRef = useRef(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    const res = await axios.get(`${API}/users`);
    setUsers(res.data);
    if (currentUser) {
      const updatedUser = res.data.find(u => u.id === currentUser.id);
      setCurrentUser(updatedUser);
    }
  };

  const fetchPostsAndNotifications = async () => {
    if (!currentUser) return;
    const postsRes = await axios.get(`${API}/posts?userId=${currentUser.id}`);
    setPosts(postsRes.data);
    const notifRes = await axios.get(`${API}/notifications/${currentUser.id}`);
    setNotifications(notifRes.data);
  };
// Available reactions like Facebook
const reactions = [
  { type: "like", emoji: "👍" },
  { type: "love", emoji: "❤️" },
  { type: "haha", emoji: "😆" },
  { type: "wow", emoji: "😮" },
  { type: "sad", emoji: "😢" },
  { type: "angry", emoji: "😡" }
];

// Track selected reaction per post
const [selectedReactions, setSelectedReactions] = useState({});
const reactToPost = async (postId, reactionType) => {
  try {
    const res = await axios.post(`${API}/posts/${postId}/react`, {
      userId: currentUser.id,
      type: reactionType
    });

    const updatedPost = res.data;

    // Update posts locally
    setPosts(prev => prev.map(p => (p.id === updatedPost.id ? updatedPost : p)));

    // Track current user's selected reaction
    const userReaction = updatedPost.likes.find(like => like.userId === currentUser.id);
    setSelectedReactions(prev => ({
      ...prev,
      [postId]: userReaction ? reactions.find(r => r.type === userReaction.type)?.emoji : "👍"
    }));
  } catch (err) {
    console.error("Reaction failed", err);
  }
};


    


  // Socket setup
  useEffect(() => {
    if (!currentUser) return;

    fetchPostsAndNotifications();

    socketRef.current = io(API, { transports: ["websocket"] });
    const socket = socketRef.current;

    socket.on("newPost", post => {
      if (post.privacy === "public" || post.userId === currentUser.id || currentUser.friends.includes(post.userId)) {
        setPosts(prev => [post, ...prev]);
      }
    });

    socket.on("likeUpdate", updatedPost => {
      setPosts(prev => prev.map(p => (p.id === updatedPost.id ? updatedPost : p)));
    });

    socket.on("commentUpdate", updatedPost => {
      setPosts(prev => prev.map(p => (p.id === updatedPost.id ? updatedPost : p)));
    });

    socket.on("notification", ({ to }) => {
      if (to === currentUser.id) fetchPostsAndNotifications();
    });

    socket.on("friendRequest", fetchUsers);

    socket.on("friendAccepted", ({ fromUserId, toUserId }) => {
      fetchUsers();
      if (currentUser.id === fromUserId || currentUser.id === toUserId) {
        setFriendMessage("🎉 Friend added successfully!");
        setTimeout(() => setFriendMessage(""), 3000);
      }
    });

    return () => socket.disconnect();
  }, [currentUser]);

  // Post actions
  const addPost = async () => {
    if (!text.trim()) return;
    await axios.post(`${API}/posts`, { userId: currentUser.id, text, media, privacy });
    setText(""); setMedia(""); setPrivacy("public");
  };

  const likePost = async id => {
    await axios.post(`${API}/posts/${id}/like`, { userId: currentUser.id });
  };

  const addComment = async postId => {
    const text = commentText[postId];
    if (!text || !text.trim()) return;
    await axios.post(`${API}/posts/${postId}/comment`, { userId: currentUser.id, text });
    setCommentText(prev => ({ ...prev, [postId]: "" }));
  };

 // Friend toggle function with instant UI update
const toggleFriend = async user => {
  const isFriend = currentUser.friends.includes(user.id);
  const sentRequest = user.friendRequests.includes(currentUser.id);
  const receivedRequest = currentUser.friendRequests.includes(user.id);

  // Optimistic UI update
  let updatedUser = { ...currentUser };

  if (isFriend) {
    updatedUser.friends = updatedUser.friends.filter(f => f !== user.id);
  } else if (sentRequest) {
    updatedUser.friendRequests = updatedUser.friendRequests.filter(f => f !== user.id);
  } else if (receivedRequest) {
    updatedUser.friends = [...updatedUser.friends, user.id];
    updatedUser.friendRequests = updatedUser.friendRequests.filter(f => f !== user.id);
    setFriendMessage("🎉 Friend added successfully!");
    setTimeout(() => setFriendMessage(""), 3000);
  } else {
    updatedUser.friendRequests = [...updatedUser.friendRequests, user.id];
  }

  setCurrentUser(updatedUser);

  // Server call
  try {
    if (isFriend) await axios.post(`${API}/users/${currentUser.id}/remove-friend`, { friendId: user.id });
    else if (sentRequest) await axios.post(`${API}/users/${user.id}/cancel-request`, { fromUserId: currentUser.id });
    else if (receivedRequest) await axios.post(`${API}/users/${currentUser.id}/accept-friend`, { fromUserId: user.id });
    else await axios.post(`${API}/users/${user.id}/friend-request`, { fromUserId: currentUser.id });

    fetchUsers(); // optional: refresh from server to keep sync
  } catch (err) {
    console.error("Friend action failed", err);
  }
};


  const logout = () => setCurrentUser(null);

  // Login screen
  if (!currentUser) return (
    <div className="login-container">
      <h2>Select a user to login</h2>
      {users.map(u => (
        <button key={u.id} onClick={() => setCurrentUser(u)}>{u.name}</button>
      ))}
    </div>
  );

  return (
    <div className="app-container">
      <div className="header">
        <h2>Social Network</h2>
        <div>
          Logged in as: <strong>{currentUser.name}</strong>
          <button className="logout-btn" onClick={logout}>Logout</button>
        </div>
      </div>

      {friendMessage && <div className="friend-message">{friendMessage}</div>}

      {/* Create Post */}
      <div className="post-input">
        <input value={text} onChange={e => setText(e.target.value)} placeholder="What's on your mind?" />
        <input value={media} onChange={e => setMedia(e.target.value)} placeholder="Media URL (optional)" />
        <select value={privacy} onChange={e => setPrivacy(e.target.value)}>
          <option value="public">Public</option>
          <option value="friends">Friends</option>
        </select>
        <button onClick={addPost}>Post</button>
      </div>

      {/* Notifications */}
      <div className="notifications">
        <h4>Notifications ({notifications.length})</h4>
        {notifications.map(n => (
          <div key={n.id} className="notification">
            {n.type === "like" && `Your post was liked by ${n.from}`}
            {n.type === "comment" && `Your post was commented by ${n.from}`}
          </div>
        ))}
      </div>

      {/* Posts */}
      <div className="posts-list">
        {posts.map(p => (
          <div key={p.id} className="post-card">
            <div className="post-header">
              <img src={p.avatar} alt={`${p.author}'s avatar`} className="avatar"/>
              <div>
                <strong>{p.author}</strong>
                <div className="privacy-label">{p.privacy}</div>
              </div>
            </div>
            <div className="post-text">{p.text}</div>
            {p.media && (p.media.endsWith(".mp4") ?
              <video src={p.media} controls className="post-media"/> :
              <img src={p.media} alt="post media" className="post-media"/>
            )}
            <div className="post-actions">
  <div className="reaction-wrapper">
    <button>
      {selectedReactions[p.id] || "👍"} 
      {p.likes.length > 0 && ` (${p.likes.length})`}
    </button>
    <div className="reaction-menu">
      {reactions.map(r => (
        <span key={r.type} onClick={() => reactToPost(p.id, r.type)}>
          {r.emoji}
        </span>
      ))}
    </div>

  </div>

  <button>
    💬 Comment ({p.comments.length})
  </button>
</div>


            {/* Comments */}
            <div className="comments-section">
              {p.comments.map(c => (
                <div key={c.id} className="comment">
                  <strong>{c.author}:</strong> {c.text}
                </div>
              ))}
              <div className="comment-input">
                <input
                  type="text"
                  placeholder="Write a comment..."
                  value={commentText[p.id] || ""}
                  onChange={e => setCommentText(prev => ({ ...prev, [p.id]: e.target.value }))}
                  onKeyPress={e => e.key === "Enter" && addComment(p.id)}
                />
                <button onClick={() => addComment(p.id)}>Comment</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="friends">
        <h4>Friends & Requests</h4>
        {users
          .filter(u => u.id !== currentUser.id)
          .map(u => {
            const isFriend = currentUser.friends.includes(u.id);
            const sentRequest = u.friendRequests.includes(currentUser.id);
            const receivedRequest = currentUser.friendRequests.includes(u.id);

            const handleFriendAction = async () => {
              try {
                if (isFriend) {
                  // Remove friend
                  await axios.post(`${API}/users/${currentUser.id}/remove-friend`, { friendId: u.id });
                } else if (sentRequest) {
                  // Cancel sent request
                  await axios.post(`${API}/users/${u.id}/cancel-request`, { fromUserId: currentUser.id });
                } else if (receivedRequest) {
                  // Accept incoming request
                  await axios.post(`${API}/users/${currentUser.id}/accept-friend`, { fromUserId: u.id });
                  setFriendMessage("🎉 Friend added!");
                  setTimeout(() => setFriendMessage(""), 3000);
                } else {
                  // Send new friend request
                  await axios.post(`${API}/users/${u.id}/friend-request`, { fromUserId: currentUser.id });
                  setFriendMessage("✅ Friend request sent!");
                  setTimeout(() => setFriendMessage(""), 3000);
                }

                // Refresh users & currentUser from backend
                const res = await axios.get(`${API}/users`);
                setUsers(res.data);
                const updatedCurrent = res.data.find(user => user.id === currentUser.id);
                setCurrentUser(updatedCurrent);

              } catch (err) {
                console.error("Friend action failed", err);
              }
            };

            return (
              <div key={u.id} className="friend-item">
                <span>{u.name}</span>
                <button className="friend-btn" onClick={handleFriendAction}>
                  {isFriend
                    ? "Friends"
                    : sentRequest
                    ? "Requested"
                    : receivedRequest
                    ? "Accept"
                    : "Add Friend"}
                </button>
              </div>
            );
          })}
      </div>



    </div>
  );
}
