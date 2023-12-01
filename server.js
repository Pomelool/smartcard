require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const { ObjectId } = require("bson");

const path = require("path");
const mongoose = require("mongoose");
const idGenerator = require("./utils/id_generator");
const cron = require("node-cron");
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { Room } = require("./schemas/room");
// const { CardV2 } = require("./schemas/cardv2");
const { Grid } = require("./schemas/grid");
const { Game } = require("./schemas/game");
const { User } = require("./schemas/user");

const app = express();
const http = require("http").Server(app);
app.use(cors());
app.use(express.json({limit: '500mb'}));
app.use(express.urlencoded({ extended: false }));

const io = require("socket.io")(http, { cors: { origin: "*" } });

const port = process.env.PORT || 8000;

//Using multer to handle image upload
const storage = multer.diskStorage({
  //Saving all uploaded files to "uploads" folder
  destination: (req, file, cb) => {
    cb(null, "uploads");
  },
  //Creating a unique file name by concatenating the field name of the file to a unique id generated by uuid
  filename: (req, file, cb) => {
    cb(null, file.fieldname + '-' + uuidv4())
  },
});
const upload = multer({ storage: storage });

const ALLROOMSDATA = {};
//Using Cron to schedule the room data maintenance task at 4am Vancouver time every day
cron.schedule(
  "00 04 * * *",
  async () => {
    // find room with id in ALLROOMSDATA index
    const rooms = await Room.find({
      id: {
        $in: Object.keys(ALLROOMSDATA)
      }
    });
    //Removing rooms from ALLROOMSDATA object that are not in the database
    for (const roomID in ALLROOMSDATA) {
      const found = rooms.find((room) => room.id === roomID);
      if (!found) {
        delete ALLROOMSDATA[roomID];
      }
    }
  }, {
    scheduled: true,
    timezone: "America/Vancouver",
  }
);

const socketUserMap = {};

// Web sockets
io.on("connection", async (socket) => {
  // Attempt to join room given roomID
  socket.on("joinRoom", async ({ roomID, username }) => {
    if (!roomID) {
      console.error("Room Invalid");
      return;
    }
    ALLROOMSDATA[roomID] ??= await Room.findOne({ id: roomID });
    if (!ALLROOMSDATA[roomID]) {
      console.error(`Can not find room: ${roomID}`);
      return;
    }
    socket.join(roomID);

    // Create server-side array "hand" for this roomID if it doesn't exist.
    // Collection of hands of all players that have and will join this room.
    ALLROOMSDATA[roomID].hand ??= {};

    // Create server-side array "hand[username]" if it doesn't exist.
    // Collection of game objects inside the hand of userID.
    ALLROOMSDATA[roomID].hand[username] ??= [];

    // Create server-side array "cardsInDeck" if it doesn't exist.
    // Collection of id of cards that belong to specific deck.
    ALLROOMSDATA[roomID].cardsInDeck ??= ALLROOMSDATA[roomID].deck?.map(deck => deck.map(({id}) => id)) ?? [];
    
    // Create server-side array "deckDimension" if it doesn't exist.
    // Collection of dimension (x, y, width, height) for card decks.
    ALLROOMSDATA[roomID].deckDimension ??= ALLROOMSDATA[roomID].deck?.map(deck => ({
                                                                              id: uuidv4(),
                                                                              x: deck[0].x,
                                                                              y: deck[0].y,
                                                                              width: deck[0].width,
                                                                              height: deck[0].height,
                                                                            })) ?? [];

    // Notify all clients when the following properties are changed.
    io.to(socket.id).emit("tableReload", {
      cards: ALLROOMSDATA[roomID].cards,
      deck: ALLROOMSDATA[roomID].deck,
      cardsInDeck: ALLROOMSDATA[roomID].cardsInDeck,
      deckDimension: ALLROOMSDATA[roomID].deckDimension,
      tokens: ALLROOMSDATA[roomID].tokens,
      pieces: ALLROOMSDATA[roomID].pieces,
      hand: ALLROOMSDATA[roomID].hand[username],
    });
    // add user to the user array here
    console.log(`User ${username} joined room ${roomID}`);
    socketUserMap[socket.id] = username;
  });

  // Listen for item Drop(dragDown) on client-side, then update the server-side information.
  socket.on("itemDrop", ({ username, roomID, itemUpdated }) => {
    // To Do: test if this condition check is required
    if (ALLROOMSDATA[roomID] && itemUpdated) {
      const { itemID, pileIds, src, dest, deckIndex, x, y } = itemUpdated;
      if (!dest && !pileIds) return;
      // identify the dragged item.
      let targetItem;
      if (src === "cards") {
        targetItem = ALLROOMSDATA[roomID].cards.find((item) => item.id === itemID);
      }else if (src === "hand") {
        targetItem = ALLROOMSDATA[roomID].hand[username].find((item) => item.id === itemID);
      } else {
        targetItem = ALLROOMSDATA[roomID][src][deckIndex].find((item) => item.id === itemID);
      }
      if (!targetItem) return;
      // From table to table
      if (!dest) {
        const piles = ALLROOMSDATA[roomID].cards.filter(({id}) => pileIds.includes(id));
        ALLROOMSDATA[roomID].cards = ALLROOMSDATA[roomID].cards.filter(({id}) => ![...pileIds, itemID].includes(id));
        piles.forEach(item => {
          item.x = -100;
          item.y = -100;
          targetItem.pile = targetItem.pile.concat(item).concat(item.pile);
          item.pile = []
        });
        ALLROOMSDATA[roomID].cards.push(targetItem);
        // other place to table
      } else if (dest === "cards") {
        if (src === "hand") {
          ALLROOMSDATA[roomID].hand[username] = ALLROOMSDATA[roomID].hand[username].filter(item => item.id !== itemID);
          itemUpdated.handItem = targetItem;
        } else {
          ALLROOMSDATA[roomID][src][deckIndex] = ALLROOMSDATA[roomID][src][deckIndex].filter((card) => card.id !== itemID);
          // Automatically remove any decks with no cards left inside them
          if (ALLROOMSDATA[roomID][src][deckIndex].length < 1) {
            ALLROOMSDATA[roomID][src].splice(deckIndex, 1);
            ALLROOMSDATA[roomID].deckDimension.splice(deckIndex, 1);
          }
        }
        ALLROOMSDATA[roomID].cards.push(targetItem);
        // To hands
      } else if (dest === "hand") {
        if (src === dest) return;
        if (src === "cards") {
          ALLROOMSDATA[roomID].cards = ALLROOMSDATA[roomID].cards.filter(({id}) => id !== itemID);
        } else {
          ALLROOMSDATA[roomID][src][deckIndex] = ALLROOMSDATA[roomID][src][deckIndex].filter(({id}) => id !== itemID);
        }

        if (targetItem.pile.length > 0) {
          const PAD = 10;
          const HAND_WIDTH = 1400;
          const CARD_WIDTH = 65;
          targetItem.pile.forEach((item, index) => {
            item.x = x;
            item.y = y;
            item.isFlipped = false;
            if (x + CARD_WIDTH + (index + 1) * PAD <= HAND_WIDTH) {
              item.x += (index + 1) * PAD;
            }
            ALLROOMSDATA[roomID].hand[username].push(item);
          });
          targetItem.pile = [];
        }
        targetItem.isFlipped = false;
        ALLROOMSDATA[roomID].hand[username].push(targetItem);
      } else {
        if (targetItem.pile.length > 0) {
          targetItem.pile.forEach((item) => {
            item.x = x;
            item.y = y;
            ALLROOMSDATA[roomID].deck[deckIndex].push(item);
          });
        }
          targetItem.pile = [];
          targetItem.x = x;
          targetItem.y = y;
          if (src === "deck") {
            ALLROOMSDATA[roomID].deck[deckIndex] = ALLROOMSDATA[roomID].deck[deckIndex].filter(card => card.id !== itemID);
          } else if (src === "hand") {
            ALLROOMSDATA[roomID][src][username] = ALLROOMSDATA[roomID][src][username].filter(card => card.id !== itemID);
            itemUpdated.handItem = targetItem;
          } else {
            ALLROOMSDATA[roomID][src] = ALLROOMSDATA[roomID][src].filter(card => card.id !== itemID);
          }
          ALLROOMSDATA[roomID].deck[deckIndex].push(targetItem);
      }
      io.to(roomID).emit("tableChangeUpdate", {
        username,
        updatedData: {...itemUpdated, type: "drop"},
      });
    }
  });

  // Listen for drag of item client-side, then update the server-side information.
  socket.on("itemDrag", ({ username, roomID, itemUpdated }) => {
    if (ALLROOMSDATA[roomID] && itemUpdated) {
      const {itemID, src, deckIndex, x, y} = itemUpdated;
      if (src === "hand") {
        ALLROOMSDATA[roomID].hand[username].map(item => {
          if (item.id === itemID) {
            item.x = x;
            item.y = y;
          }
          return item;
        });
        // drag in hand is not revealed to others, no need to emit.
        return;
      }
      if (src === "cards") {
        ALLROOMSDATA[roomID].cards.map(item => {
          if (item.id === itemID) {
            item.x = x;
            item.y = y;
          }
          return item;
        });
      } else {
        ALLROOMSDATA[roomID][src][deckIndex].map(item => {
          if (item.id === itemID) {
            item.x = x;
            item.y = y;
          }
          return item;
        });
      }
      io.to(roomID).emit("tableChangeUpdate", {
        username,
        updatedData: {...itemUpdated, type: "drag"},
      });
    }
  });

  // Listen for item Action (flip, etc.) client-side, then update the server-side information.
  socket.on("itemAction", ({ username, roomID, itemUpdated }) => {
    if (ALLROOMSDATA[roomID] && itemUpdated) {
      const { itemID, option, isFlipped, isLocked, shuffledPile, splitPile } = itemUpdated;
      if (option === "Flip") {
        ALLROOMSDATA[roomID].cards.map(item => {
          if (item.id !== itemID) return item;
          if (item.pile.length > 0) {
            item.pile.map(itemInPile => itemInPile.isFlipped = isFlipped);
          }
          item.isFlipped = isFlipped;
          return item;
        });
      } else if (option === "Disassemble") {
        ALLROOMSDATA[roomID].cards.forEach((card) => {
          if (card.id === itemID && card.pile.length > 0) {
            const xOffset = card.x > 600 ? -20 : 20;
            const yOffset = card.y > 240 ? -20 : 20;
            card.pile.forEach((cardInPile, index) => {
              ALLROOMSDATA[roomID].cards.push(cardInPile);
              cardInPile.x = card.x + (index + 1) * xOffset;
              cardInPile.y = card.y + (index + 1) * yOffset;
            });
            card.pile = []
          };
        });
      } else if (option == 'Shuffle') {
        const cards = ALLROOMSDATA[roomID].cards.map(card => {
          if (card.id === itemID && card.pile.length > 0) {
            card = shuffledPile.finalCard;
          }
          return card;
        });
        ALLROOMSDATA[roomID].cards = cards;
      } else if (option === "Lock" || option === "Unlock") {
        ALLROOMSDATA[roomID].cards = isLocked[0];
        ALLROOMSDATA[roomID].deck = isLocked[1];
        ALLROOMSDATA[roomID].deckDimension = isLocked[2];
      } else if (option === "Split") {
        ALLROOMSDATA[roomID].cards = splitPile;
      }
      io.to(roomID).emit("tableChangeUpdate", {
        username,
        updatedData: {...itemUpdated, type: "action"},
      });
    }
  });

  // Listen for mouseMoves client-side, and update the server-side information.
  socket.on("mouseMove", ({
    x,
    y,
    username,
    roomID
  }) => {
    io.to(roomID).emit("mousePositionUpdate", {
      x: x,
      y: y,
      username: username,
    });
  });

  socket.on("disconnecting", () => {
    const rooms = Array.from(socket.rooms);
    const username = socketUserMap[socket.id];

    rooms.forEach((room) => {
      if (room !== socket.id) {
        // // This check ensures that you don't emit to the socket's own ID
        io.to(room).emit("userDisconnected", {
          username: username,
        });

        // Remove the entry from the map to clean up
        delete socketUserMap[socket.id];

        console.log('User ' + username + ' left room ' + room);
      }
    });
  });
});

io.on("connect_error", (err) => {
  console.log(`connect_error due to ${err.message}`);
});

// Restful Apis
// Get all currently hosted rooms.
app.get("/api/rooms", async (req, res) => {
  try {
    res.json(await Room.find());
  } catch (err) {
    res.json({
      status: "error",
      message: err
    });
    console.log(err);
  }
});

// Get room by id
app.get("/api/room", async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) {
      throw new Error("Room ID is required");
    }
    // If id is valid, load room data.
    const roomData = await Room.findOne({ id: id });

    // If roomData is invalid, respond with error.
    if (!roomData) {
      res.status(400).json({ status: "error", message: "Invalid room ID" });
      return;
    }

    // If roomData is valid, respond with roomData.
    res.json(roomData);
  } catch (err) {
    res.status(404).json({
      status: "error",
      message: err.message
    });
  }
});

//create room
app.post("/api/room", async (req, res) => {
  const ROOM_ID_LENGTH = 10;

  /**
   * Fill up the array to the number of Items declared.
   * @param {Array} deck 
   * @param {Number} numCards 
   * @returns Array with size numCards, filled with deep copies of items.
   */
  const setUpTokenAndPiece = (deck, numCards) => {
    if (deck.length < numCards) {
      const maxIndex = deck.length;
      return Array.from({length: numCards}, (_, i) => {
        const newItem = JSON.parse(JSON.stringify(deck[i % maxIndex]));
        newItem.id += i;
        return newItem;
      });
    }
    return deck;
  };
  
  /**
   * Shuffle the cards before placing on table.
   * @param {Array} array of cards 
   */
  const shuffleArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
  };

  /**
   * Filter the item array by the type specified
   * @param {Array} items all items
   * @param {String} itemType Card, Token or Piece 
   * @returns Card, Token or Piece array
   */
  const filterMapItem = (items, itemType) => {
    return items.reduce((acc, item) => {
      if (item.type === itemType) {
        if (itemType !== "Card") {
          acc.push(setUpTokenAndPiece(item.deck, item.numCards));
        } else {
          shuffleArray(item.deck);
          acc.push(item.deck);
        }
      }
      return acc;
    }, []);
  };
  
  try {
    const deckIds = req.body?.cardDeck;
    if (!deckIds || deckIds.length < 1) {
      throw new Error("Error: room body missing/corrupted.");
    }
    let roomID = idGenerator(ROOM_ID_LENGTH);
    while (await Room.findOne({ id: roomID })) {
      roomID = idGenerator(ROOM_ID_LENGTH);
    }
    
    const gameItemData = await Grid.find({ _id: { $in: deckIds } });
    const gameRoomData = {
      id: roomID,
      name: req.body.name,
      deck: filterMapItem(gameItemData, "Card"),
      tokens: filterMapItem(gameItemData, "Token"),
      pieces: filterMapItem(gameItemData, "Piece"),
      hand: {},
      cards: [],
    };

    const result = await Room.create(gameRoomData);
    if (!result) {
      throw new Error("Error: Room not created");
    }
    ALLROOMSDATA[roomID] = gameRoomData;
    res.json(result);
  } catch (err) {
    res.json({
      status: "error",
      message: err
    });
    console.log(err);
  }
});

// Registering a new user to the database.
app.post("/api/register", async (req, res) => {
  const newUser = new User({
    username: req.body.username,
    email: req.body.email,
    password: req.body.password,
  });
  try {
    // Check if a user with the same username already exists in the database
    if (await User.findOne({ 
        username: req.body.username
      })) {
      throw new Error("Username already exists");
    }
    const result = await newUser.save(); // Save the new user to the database
    if (!result) {
      throw new Error("Error: User failed to be created");
    }

    // Respond with JSON object containing success status, a message, and the newly created user
    res.json({
      status: "success",
      message: "User created",
      user: newUser
    });
  } catch (err) {
    res.status(400).json({
      message: err.message
    });
  }
});

// Logging in and creating a new session.
app.post("/api/login", async (req, res) => {
  // Check if a user with the same username already exists in the database.
  try {
    const user = await User.findOne({
      username: req.body.username,
    });
    if (!user) {
      throw new Error("Invalid username or password");
    }

    // Check if the inputted password matches the hashed password in the database using bcryptjs.compare().
    const passwordMatch = await bcryptjs.compare(req.body.password, user.password);
    if (!passwordMatch) {
      throw new Error("Invalid password");
    }

    // After successful login, create a JWT authentication token. Sign it with the user's id and username, set to expire in 1 hour,
    // and send it back to the client.
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Respond with a JSON object containing a success status, a message, the user object, and the generated token
    res.json({
      status: "success",
      message: "User login successful",
      user: user,
      token: token,
    });
  } catch (err) {
    res.status(400).json({
      message: err.message
    });
  }
});

app.get('/api/profile', async (req, res) => {
  // Handle the request and send a response
  const creatorId = req.query.creatorId;
  try {
    const user = await User.findById(creatorId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      email: user.email,
    });
  } catch (err) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/profileUpdate', async (req, res) => {
  try {
    // Find the user by their user ID
    const existingUser = await User.findById(req.query.creatorId);

    if (!existingUser) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    // Check if the new username is already in use by someone else
    const newUsername = req.body.username;
    const usernameExists = await User.findOne({ username: newUsername });

    if (usernameExists) {
      return res.status(400).json({
        message: "Username already exists"
      });
    }

    // Update the username of the existing user
    existingUser.username = newUsername;
    await existingUser.save();

    res.json({
      status: "success",
      message: "Profile updated",
      user: existingUser,
    });
  } catch (err) {
    res.status(400).json({
      message: err.message
    });
  }
});

app.get("/api/games", async (req, res) => {
  try {
    let games = null;
    if (req.query.gameId) {
      games = await Game.findOne({
        _id: new ObjectId(req.query.gameId)
      });
    } else {
      games = await Game.find({
        creator: new ObjectId(req.query.creatorId)
      });
    }
    if (!games) {
      throw new Error("No games");
    }
    res.status(200).send({
      message: "Games received",
      savedGames: games
    });

  } catch (err) {
    console.error("Failed to retreive games", err);
    res.status(500).send("Failed to retreive games.");
  }
});

/**
 * Receive game item formData from imageUploadForm and create array of game Item.
 */
app.post("/api/upload",
          upload.fields([{
            name: "image", maxCount: 1}, {
            name: "backFile", maxCount: 1}]), async (req, res) => {
  try {
    const { image, backFile } = req.files;
    const [{ filename: facefile, mimetype: faceType }] = image;
    const {
      isLandscape,
      isSameBack,
      itemType,
      numAcross,
      numDown,
      numTotal
    } = req.body;
    const imageData = fs.readFileSync(
      path.join(__dirname + "/uploads/" + facefile)
    );
    let backArray = null;
    const backType = backFile?.[0].mimetype || "";
    
    // check if backfile exist (card, token)
    if (backFile?.[0].filename) {
      const backImageData = fs.readFileSync(
        path.join(__dirname + "/uploads/" + backFile[0].filename)
      );
      backArray = await sliceImages(itemType, backImageData, numAcross, numDown, numTotal, false, isSameBack);
    }
    const faceArray = await sliceImages(itemType, imageData, numAcross, numDown, numTotal);
    
    const gameItemDocuments = await createGameObjects(
                            faceArray, backArray, faceType, backType, isLandscape, itemType);
    
    //To Do: change the key to be more general between card, token, piece and additional future items
    const gameItemDeck = {
      name: facefile,
      numCards: parseInt(numTotal),
      imageGrid: {
        data: imageData,
        contentType: faceType,
      },
      deck: gameItemDocuments,
      type: itemType,
    };

    res.status(200).send({
      message: "Item created successfully",
      newItem: gameItemDeck,
    });
  } catch (error) {
    console.error("Failed to create item", error);
    res.status(500).send("Failed to create item");
  }
});

/**
 * create Grid from each items passed in from BuildGamePage.handleSave()
 */
app.post("/api/addDecks", async (req, res) => {
  try {
    const gameObject = req.body;
    // To Do: CardV2 not used. Assess requirement in future and keep/remove.
    // await CardV2.create(gameObject.deck);
    const result = await Grid.create(gameObject);
    res.status(200).send({
      deckId: result._id,
    });
  } catch (error) {
    console.error("Failed to insert grid", error);
    res.status(500).send("Failed to insert grid");
  }
});

/**
 * Create Game from Array of Grid Ids from BuildGamePage.handleSave()
 */
app.post("/api/saveGame", async (req, res) => {
  try {
    // To Do: change newDeckIds, cardDeck to more general term
    const { name, players, creatorId, newDeckIds } = req.body;
    if (creatorId) {
      //Create a game now
      const gameObject = {
        name: name.substring(0, 20),
        players: parseInt(players),
        creator: new ObjectId(creatorId),
        cardDeck: newDeckIds.map((id) => new ObjectId(id)),
      };
      await Game.create(gameObject);
      res.status(200).send("Game created successfully");
    }
  } catch (error) {
    console.error("Failed to save game", error);
    res.status(500).send("Failed to save game");
  }
});

/**
 * Slice image to grid specified by cols and row.
 * The max dimension is set for cards and tokens.
 * 
 * @param {String} itemType Card, Token or Piece
 * @param {File} ImageData
 * @param {Number} cols number of items across
 * @param {Number} rows number of items down
 * @param {Number} total total number of items in final array
 * @param {Boolean} isFace whether the image is back or face image file
 * @param {Boolean} isSameBack if true, retain the back image as whole without slicing
 * 
 * @returns Array of processing image buffer
 */
const sliceImages = async (itemType, ImageData, cols, rows, total, isFace = true, isSameBack = false) => {
  // parsing may not be necessary
  const numCols = parseInt(cols);
  const numRows = parseInt(rows);
  const numTotal = parseInt(total);

  const inputBuffer = Buffer.from(ImageData);
  const imageInput = sharp(inputBuffer);
  const { width: imgWidth, height: imgHeight } = await imageInput.metadata();

  // draw border around image
  const extend = itemType === "Card" ? 2 : {};
  const resize = {};
  
  // for backImage with same back
  if (!isFace && isSameBack) {
    if (imgWidth > imgHeight) {
      resize.width = 91;
    } else {
      resize.height = 91;
    }
    const formattedImageBuffer = await imageInput.resize(resize).extend(extend).toBuffer()
    return Array(Math.min(numTotal, cols*rows)).fill(formattedImageBuffer);
  }

  // Dimension of each item image
  const itemWidth = Math.floor(imgWidth / numCols);
  const itemHeight = Math.floor(imgHeight / numRows);
  if (itemType !== "Piece") {
    if (itemWidth > itemHeight) {
      resize.width = 91;
    } else {
      resize.height = 91;
    }
  }

  // Slice the image and store in array 
  const itemArray = [];
  for (let i = 0; i < numRows; i++) {
    const y = i * itemHeight;
    for (let j = 0; j < numCols; j++) {
      const input = sharp(inputBuffer);
      const x = j * itemWidth;
      // check if enough space for a card is available to be sliced
      if (x + itemWidth <= imgWidth && y + itemHeight <= imgHeight) {
        await input
          .extract({ left: x, top: y, width: itemWidth, height: itemHeight })
          .resize(resize)
          .extend(extend)
          .toBuffer()
          .then((res) => {
            itemArray.push(res);
          });
      }
    }
  }
  return itemArray.slice(0, numTotal);
};

/**
 * Combine face and back array to create a group of functional items
 * with two side (back.data will be null for single sided item (piece))
 * 
 * @param {Array} cardArray Array of buffer(base64)
 * @param {Array} backArray Array of buffer(base64)
 * @param {String} faceType image format (e.g. image/webp)
 * @param {String} backType image format (e.g. image/webp)
 * @param {Boolean} isLandscape whether to rotate the image or not
 * @param {String} itemType Card, Token or Piece
 * @returns Array of CardV2 object
 */
const createGameObjects = async (
  cardArray, backArray, faceType, backType, isLandscape, itemType) => {
  //If single sided, create array of null
  backArray ??= Array(cardArray.length).fill(null);

  return cardArray.map((buffer, index) => ({
      id: uuidv4(),
      x: null,
      y: null,
      imageSource: {
        front: {
          data: buffer,
          contentType: faceType,
        },
        back: {
          data: backArray[index],
          contentType: backType,
        }

      },
      pile: [],
      type: itemType,
      isFlipped: false,
      isLandscape: !!isLandscape,
    }));
};

// If the NODE_ENV variable is set to production, serve static files from build folder
if (process.env.NODE_ENV === "production") {
  app.use(express.static("build"));

  // Handle all routes with a wildcard (*) and send the "index.html" file
  app.get("*", (req, res) => {
    res.sendFile(path.resolve(__dirname, "build", "index.js"));
  });
}

// Start the server and establish a MongoDB connection
http.listen(port, async (err) => {
  if (err) return console.log(err);

  try {
    // Connect to the MongoDB database using provided connection string
    await mongoose.connect(
      "mongodb+srv://root:S4ndB0x@game-sandbox.altns89.mongodb.net/data?retryWrites=true&w=majority"
    );
  } catch (error) {
    console.log("db error");
  }
  console.log("Server running on port: ", port);
});