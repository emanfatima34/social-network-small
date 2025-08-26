const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

// ===== JSON persistence setup =====
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const usersFile = path.join(DATA_DIR, "users.json");
const postsFile = path.join(DATA_DIR, "posts.json");
const notificationsFile = path.join(DATA_DIR, "notifications.json");

// Load or initialize
let users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile)) : [
  { id: 1, name: "Alice", avatar: "https://i.pravatar.cc/150?img=1", bio: "Hello, I am Alice", friends: [], friendRequests: [] },
  { id: 2, name: "Bob", avatar: "https://i.pravatar.cc/150?img=2", bio: "Hey, Bob here!", friends: [], friendRequests: [] },
  { id: 3, name: "Charlie", avatar: "https://i.pravatar.cc/150?img=3", bio: "Charlie’s profile", friends: [], friendRequests: [] },
];
let posts = fs.existsSync(postsFile) ? JSON.parse(fs.readFileSync(postsFile)) : [];
let notifications = fs.existsSync(notificationsFile) ? JSON.parse(fs.readFileSync(notificationsFile)) : [];

// ===== Helpers =====
const saveData = () => {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
  fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2));
  fs.writeFileSync(notificationsFile, JSON.stringify(notifications, null, 2));
};

const findUser = id => users.find(u => u.id === parseInt(id));
const findPost = id => posts.find(p => p.id === parseInt(id));

// ===== API Routes =====

// Get all users
app.get("/users", (req, res) => res.json(users));

// Get posts visible to user
app.get("/posts", (req, res) => {
  const userId = parseInt(req.query.userId);
  const user = findUser(userId);
  if (!user) return res.json([]);

  const visiblePosts = posts.filter(post => {
    if (post.privacy === "public") return true;
    if (post.privacy === "friends" && user.friends.includes(post.userId)) return true;
    if (post.userId === userId) return true;
    return false;
  });

  res.json(visiblePosts);
});

// Add a post
app.post("/posts", (req, res) => {
  const { userId, text, media, privacy } = req.body;
  const user = findUser(userId);
  if (!user) return res.status(400).json({ message: "User not found" });

  const newPost = {
    id: Date.now(),
    userId: user.id,
    author: user.name,
    avatar: user.avatar,
    text,
    media: media || null,
    likes: [], // array of { userId, type } for reactions
    comments: [],
    privacy: privacy || "public",
  };

  posts.unshift(newPost);
  saveData();
  io.emit("newPost", newPost);
  res.json(newPost);
});
// React to a post (like, love, etc.)
app.post("/posts/:id/react", (req, res) => {
  const post = findPost(req.params.id);
  const { userId, type } = req.body;
  if (!post) return res.status(404).json({ message: "Post not found" });

  // Remove previous reaction by the same user
  post.likes = post.likes.filter(like => like.userId !== userId);

  // Add new reaction
  post.likes.push({ userId, type });

  // Add notification for post owner
  if (post.userId !== userId) {
    notifications.push({
      id: Date.now(),
      type: "reaction",
      from: userId,
      to: post.userId,
      postId: post.id,
      reactionType: type
    });
  }

  saveData();

  // Emit updates via socket
  io.emit("likeUpdate", post);
  io.emit("notification", { to: post.userId });

  res.json(post);
});



// Add a comment
app.post("/posts/:id/comment", (req, res) => {
  const post = findPost(req.params.id);
  const { userId, text } = req.body;
  const user = findUser(userId);
  if (!post) return res.status(404).json({ message: "Post not found" });
  if (!user) return res.status(400).json({ message: "User not found" });

  const comment = { id: Date.now(), userId, author: user.name, avatar: user.avatar, text };
  post.comments.push(comment);

  if (post.userId !== userId) {
    notifications.push({ id: Date.now(), type: "comment", from: userId, to: post.userId, postId: post.id });
  }

  saveData();
  io.emit("commentUpdate", post);
  io.emit("notification", { to: post.userId });
  res.json(comment);
});

// ===== Friend Endpoints =====

// Send friend request
app.post("/users/:id/friend-request", (req, res) => {
  const targetUser = findUser(req.params.id);
  const { fromUserId } = req.body;
  if (!targetUser) return res.status(404).json({ message: "User not found" });

  if (!targetUser.friendRequests.includes(fromUserId) && !targetUser.friends.includes(fromUserId)) {
    targetUser.friendRequests.push(fromUserId);
  }

  saveData();
  io.emit("friendRequest", { to: targetUser.id });
  res.json({ message: "Request sent" });
});

// Accept friend request
app.post("/users/:id/accept-friend", (req, res) => {
  const currentUser = findUser(req.params.id);
  const { fromUserId } = req.body;
  const fromUser = findUser(fromUserId);
  if (!currentUser || !fromUser) return res.status(404).json({ message: "User not found" });

  currentUser.friendRequests = currentUser.friendRequests.filter(id => id !== fromUserId);

  if (!currentUser.friends.includes(fromUserId)) currentUser.friends.push(fromUserId);
  if (!fromUser.friends.includes(currentUser.id)) fromUser.friends.push(currentUser.id);

  saveData();
  io.emit("friendAccepted", { fromUserId, toUserId: currentUser.id });
  res.json({ message: "Friend added" });
});

// Cancel sent request
app.post("/users/:id/cancel-request", (req, res) => {
  const targetUser = findUser(req.params.id);
  const { fromUserId } = req.body;
  if (!targetUser) return res.status(404).json({ message: "User not found" });

  targetUser.friendRequests = targetUser.friendRequests.filter(id => id !== fromUserId);
  saveData();
  io.emit("friendRequestUpdated", { userId: targetUser.id });
  res.json({ message: "Request canceled" });
});

// Remove friend
app.post("/users/:id/remove-friend", (req, res) => {
  const currentUser = findUser(req.params.id);
  const { friendId } = req.body;
  const friend = findUser(friendId);
  if (!currentUser || !friend) return res.status(404).json({ message: "User not found" });

  currentUser.friends = currentUser.friends.filter(id => id !== friendId);
  friend.friends = friend.friends.filter(id => id !== currentUser.id);
  saveData();
  io.emit("friendRemoved", { userId: currentUser.id, friendId });
  res.json({ message: "Friend removed" });
});


// Delete incoming request
app.post("/users/:id/delete-request", (req, res) => {
  const currentUser = findUser(req.params.id);
  const { fromUserId } = req.body;
  if (!currentUser) return res.status(404).json({ message: "User not found" });

  currentUser.friendRequests = currentUser.friendRequests.filter(id => id !== fromUserId);
  saveData();
  res.json({ message: "Request deleted" });
});

// Get notifications
app.get("/notifications/:userId", (req, res) => {
  const userId = parseInt(req.params.userId);
  res.json(notifications.filter(n => n.to === userId));
});

// Socket.io connection
io.on("connection", socket => console.log("User connected:", socket.id));

// Start server
server.listen(5000, () => console.log("Server running at http://localhost:5000")); 