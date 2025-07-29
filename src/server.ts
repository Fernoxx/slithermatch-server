import { Server } from 'socket.io';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "https://slither-match.vercel.app",
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Types
interface Position {
  x: number;
  y: number;
}

interface Snake {
  id: string;
  segments: Position[];
  angle: number;
  score: number;
  radius: number;
  color: string;
  isDead: boolean;
  killCount: number;
}

interface Player {
  id: string;
  socketId: string;
  address: string;
  username: string;
  profilePic?: string;
  snake: Snake;
  lastUpdate: number;
  joinedAt: number;
}

interface Food {
  id: string;
  position: Position;
  color: string;
  radius: number;
}

interface GameRoom {
  id: string;
  type: 'paid' | 'casual' | 'freeplay';
  players: Map<string, Player>;
  food: Map<string, Food>;
  state: 'waiting' | 'countdown' | 'playing' | 'ended';
  startTime?: number;
  countdownStartTime?: number;
  winner?: string;
  worldSize: number;
  maxPlayers: number;
  minPlayers: number;
  leaderboard?: Array<{id: string; username: string; score: number}>;
}

// Game storage
const games = new Map<string, GameRoom>();
const playerToGame = new Map<string, string>();

// Room management
let activePaidRoom: string | null = null;
const activeCasualRooms = new Set<string>();
let freePlayRoom: GameRoom | null = null;

// Constants
const WORLD_SIZE_PAID = 1332;
const WORLD_SIZE_CASUAL = 2000;
const WORLD_SIZE_FREEPLAY = 3000;
const FOOD_COUNT_PAID = 150;
const FOOD_COUNT_CASUAL = 200;
const FOOD_COUNT_FREEPLAY = 500;
const TICK_RATE = 60;
const SEND_RATE = 30;
const LEADERBOARD_UPDATE_RATE = 1000; // 1 second

// Room configs
const ROOM_CONFIGS = {
  paid: {
    maxPlayers: 5,
    minPlayers: 3,
    worldSize: WORLD_SIZE_PAID,
    foodCount: FOOD_COUNT_PAID
  },
  casual: {
    maxPlayers: 5,
    minPlayers: 3,
    worldSize: WORLD_SIZE_CASUAL,
    foodCount: FOOD_COUNT_CASUAL,
    maxRooms: 3
  },
  freeplay: {
    maxPlayers: 30,
    minPlayers: 1,
    worldSize: WORLD_SIZE_FREEPLAY,
    foodCount: FOOD_COUNT_FREEPLAY
  }
};

// Colors
const FOOD_COLORS = ['#00ffd1', '#fc4fff', '#f1ff00', '#ff1f4d'];
const PLAYER_COLORS = ['#00ffff', '#ff00ff', '#ffff00', '#00ff00', '#ff0000', '#ff8800', '#0088ff', '#8800ff'];

// Helper functions
function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function generateFood(worldSize: number): Food {
  return {
    id: generateId(),
    position: {
      x: 50 + Math.random() * (worldSize - 100),
      y: 50 + Math.random() * (worldSize - 100)
    },
    color: FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)],
    radius: 4 + Math.random() * 2
  };
}

function generateStartPosition(worldSize: number): Position {
  const margin = 200;
  return {
    x: margin + Math.random() * (worldSize - 2 * margin),
    y: margin + Math.random() * (worldSize - 2 * margin)
  };
}

function getPlayerColor(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

// Initialize freeplay room on startup
function initializeFreePlayRoom() {
  const roomId = 'freeplay-main';
  freePlayRoom = {
    id: roomId,
    type: 'freeplay',
    players: new Map(),
    food: new Map(),
    state: 'playing', // Always playing
    worldSize: WORLD_SIZE_FREEPLAY,
    maxPlayers: 30,
    minPlayers: 1,
    leaderboard: []
  };

  // Generate initial food
  for (let i = 0; i < FOOD_COUNT_FREEPLAY; i++) {
    const food = generateFood(WORLD_SIZE_FREEPLAY);
    freePlayRoom.food.set(food.id, food);
  }

  games.set(roomId, freePlayRoom);
  console.log('Freeplay room initialized');
}

// Initialize server
initializeFreePlayRoom();

// Socket handlers
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  let currentGameId: string | null = null;

  socket.on('find-game', async (data: {
    gameType: 'paid' | 'casual' | 'freeplay';
    playerInfo: {
      address: string;
      username: string;
      profilePic?: string;
    };
  }) => {
    try {
      const { gameType, playerInfo } = data;
      
      // Leave previous game if any
      if (currentGameId) {
        handlePlayerLeave(socket.id, currentGameId);
      }

      let gameId: string | null = null;
      let game: GameRoom | null = null;

      switch (gameType) {
        case 'paid':
          // Only one paid room at a time
          if (activePaidRoom) {
            const existingGame = games.get(activePaidRoom);
            if (existingGame && existingGame.state === 'waiting' && existingGame.players.size < existingGame.maxPlayers) {
              gameId = activePaidRoom;
              game = existingGame;
            } else {
              socket.emit('game-unavailable', { 
                message: 'Paid lobby is full or in progress. Please wait for the current game to end.' 
              });
              return;
            }
          } else {
            // Create new paid room
            gameId = `paid-${generateId()}`;
            game = createGameRoom(gameId, 'paid');
            activePaidRoom = gameId;
          }
          break;

        case 'casual':
          // Find available casual room
          for (const roomId of activeCasualRooms) {
            const room = games.get(roomId);
            if (room && room.state === 'waiting' && room.players.size < room.maxPlayers) {
              gameId = roomId;
              game = room;
              break;
            }
          }

          // Create new casual room if possible
          if (!game && activeCasualRooms.size < ROOM_CONFIGS.casual.maxRooms) {
            gameId = `casual-${generateId()}`;
            game = createGameRoom(gameId, 'casual');
            activeCasualRooms.add(gameId);
          }

          if (!game) {
            socket.emit('game-unavailable', { 
              message: 'All casual lobbies are full. Please wait for a game to end.' 
            });
            return;
          }
          break;

        case 'freeplay':
          // Always join the main freeplay room
          gameId = 'freeplay-main';
          game = freePlayRoom!;
          break;
      }

      if (!game || !gameId) {
        socket.emit('error', { message: 'Failed to find or create game' });
        return;
      }

      // Add player to game
      joinGame(socket, game, gameId, playerInfo);
      currentGameId = gameId;

    } catch (error) {
      console.error('Error finding game:', error);
      socket.emit('error', { message: 'Failed to join game' });
    }
  });

  socket.on('respawn', (data: { username?: string }) => {
    const gameId = playerToGame.get(socket.id);
    if (!gameId) return;

    const game = games.get(gameId);
    if (!game || game.type !== 'freeplay') return;

    const player = Array.from(game.players.values())
      .find(p => p.socketId === socket.id);

    if (player) {
      // Reset snake
      const startPos = generateStartPosition(game.worldSize);
      player.snake = {
        id: player.id,
        segments: Array.from({ length: 10 }, (_, i) => ({
          x: startPos.x - i * 10,
          y: startPos.y
        })),
        angle: 0,
        score: 0,
        radius: 8,
        color: getPlayerColor(game.players.size),
        isDead: false,
        killCount: 0
      };

      // Update username if provided
      if (data.username) {
        player.username = data.username;
      }

      socket.emit('respawned', {
        snake: player.snake
      });

      socket.to(gameId).emit('player-respawned', {
        playerId: player.id,
        snake: player.snake
      });
    }
  });

  socket.on('move', (data: { angle: number }) => {
    const gameId = playerToGame.get(socket.id);
    if (!gameId) return;

    const game = games.get(gameId);
    if (!game) return;

    const player = Array.from(game.players.values())
      .find(p => p.socketId === socket.id);
    
    if (player && !player.snake.isDead) {
      player.snake.angle = data.angle;
      player.lastUpdate = Date.now();
    }
  });

  socket.on('ping', () => {
    socket.emit('pong', Date.now());
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    if (currentGameId) {
      handlePlayerLeave(socket.id, currentGameId);
    }
  });
});

function createGameRoom(gameId: string, type: 'paid' | 'casual' | 'freeplay'): GameRoom {
  const config = ROOM_CONFIGS[type];
  const game: GameRoom = {
    id: gameId,
    type,
    players: new Map(),
    food: new Map(),
    state: 'waiting',
    worldSize: config.worldSize,
    maxPlayers: config.maxPlayers,
    minPlayers: config.minPlayers
  };

  // Generate initial food
  for (let i = 0; i < config.foodCount; i++) {
    const food = generateFood(config.worldSize);
    game.food.set(food.id, food);
  }

  games.set(gameId, game);
  console.log(`${type} game ${gameId} created`);
  return game;
}

function joinGame(socket: any, game: GameRoom, gameId: string, playerInfo: any) {
  // Create player
  const startPos = generateStartPosition(game.worldSize);
  const player: Player = {
    id: playerInfo.address,
    socketId: socket.id,
    address: playerInfo.address,
    username: playerInfo.username,
    profilePic: playerInfo.profilePic,
    snake: {
      id: playerInfo.address,
      segments: Array.from({ length: 10 }, (_, i) => ({
        x: startPos.x - i * 10,
        y: startPos.y
      })),
      angle: 0,
      score: 0,
      radius: 8,
      color: getPlayerColor(game.players.size),
      isDead: false,
      killCount: 0
    },
    lastUpdate: Date.now(),
    joinedAt: Date.now()
  };

  // Add to game
  game.players.set(player.id, player);
  playerToGame.set(socket.id, gameId);
  
  // Join socket room
  socket.join(gameId);

  // Send initial state
  socket.emit('game-joined', {
    gameId: gameId,
    playerId: player.id,
    gameType: game.type,
    gameState: {
      players: Array.from(game.players.values()).map(p => ({
        id: p.id,
        username: p.username,
        snake: p.snake
      })),
      food: Array.from(game.food.values()),
      worldSize: game.worldSize,
      state: game.state,
      leaderboard: game.leaderboard
    }
  });

  // Notify others
  socket.to(gameId).emit('player-joined', {
    id: player.id,
    username: player.username,
    snake: player.snake
  });

  console.log(`Player ${player.username} joined ${game.type} game ${gameId}`);

  // Check if should start countdown (not for freeplay)
  if (game.type !== 'freeplay' && game.players.size >= game.minPlayers && game.state === 'waiting') {
    startCountdown(game, gameId);
  }
}

function handlePlayerLeave(socketId: string, gameId: string) {
  const game = games.get(gameId);
  if (!game) return;

  const player = Array.from(game.players.values())
    .find(p => p.socketId === socketId);

  if (player) {
    // Drop food if alive
    if (!player.snake.isDead && game.type !== 'freeplay') {
      dropFoodFromSnake(game, player);
    }

    game.players.delete(player.id);
    playerToGame.delete(socketId);
    
    io.to(gameId).emit('player-left', { playerId: player.id });
    
    // Handle game end conditions (not for freeplay)
    if (game.type !== 'freeplay') {
      if (game.state === 'playing') {
        checkWinCondition(game, gameId);
      }
      
      // Clean up empty games
      if (game.players.size === 0) {
        endGame(game, gameId);
      }
    }
  }
}

function startCountdown(game: GameRoom, gameId: string) {
  game.state = 'countdown';
  game.countdownStartTime = Date.now();
  
  io.to(gameId).emit('countdown-started', { 
    duration: 30,
    startTime: game.countdownStartTime 
  });
  
  setTimeout(() => {
    if (game.state === 'countdown' && game.players.size >= game.minPlayers) {
      startGame(game, gameId);
    }
  }, 30000);
}

function startGame(game: GameRoom, gameId: string) {
  game.state = 'playing';
  game.startTime = Date.now();
  
  io.to(gameId).emit('game-started', {
    startTime: game.startTime
  });
  
  console.log(`${game.type} game ${gameId} started with ${game.players.size} players`);
}

function dropFoodFromSnake(game: GameRoom, player: Player): Food[] {
  const droppedFood: Food[] = [];
  
  player.snake.segments.forEach((segment, index) => {
    if (index % 2 === 0) {
      const food: Food = {
        id: generateId(),
        position: {
          x: Math.max(10, Math.min(game.worldSize - 10, segment.x + (Math.random() - 0.5) * 20)),
          y: Math.max(10, Math.min(game.worldSize - 10, segment.y + (Math.random() - 0.5) * 20))
        },
        color: FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)],
        radius: 4 + Math.random() * 2
      };
      game.food.set(food.id, food);
      droppedFood.push(food);
    }
  });
  
  return droppedFood;
}

function checkWinCondition(game: GameRoom, gameId: string) {
  const alivePlayers = Array.from(game.players.values())
    .filter(p => !p.snake.isDead);
  
  if (alivePlayers.length <= 1) {
    game.state = 'ended';
    
    const winner = alivePlayers.length === 1 ? alivePlayers[0] : null;
    if (winner) {
      game.winner = winner.id;
    }
    
    io.to(gameId).emit('game-ended', {
      winner: winner ? {
        id: winner.id,
        username: winner.username,
        address: winner.address,
        score: winner.snake.score
      } : null,
      gameType: game.type
    });
    
    console.log(`${game.type} game ${gameId} ended. Winner: ${winner?.username || 'No winner'}`);
    
    endGame(game, gameId);
  }
}

function endGame(game: GameRoom, gameId: string) {
  // Clean up room references
  if (game.type === 'paid') {
    activePaidRoom = null;
  } else if (game.type === 'casual') {
    activeCasualRooms.delete(gameId);
  }
  
  // Remove game after delay
  setTimeout(() => {
    games.delete(gameId);
    console.log(`${game.type} game ${gameId} cleaned up`);
  }, 5000);
}

function updateLeaderboard(game: GameRoom) {
  const players = Array.from(game.players.values())
    .filter(p => !p.snake.isDead)
    .sort((a, b) => b.snake.score - a.snake.score)
    .slice(0, 10)
    .map(p => ({
      id: p.id,
      username: p.username,
      score: p.snake.score
    }));
  
  game.leaderboard = players;
}

// Game physics loop
setInterval(() => {
  games.forEach((game, gameId) => {
    if (game.state !== 'playing' && game.type !== 'freeplay') return;

    const playersArray = Array.from(game.players.values());

    playersArray.forEach((player) => {
      if (player.snake.isDead) return;

      const snake = player.snake;
      const head = snake.segments[0];
      const speed = 1.8;
      
      // Update head position
      const newHead = {
        x: head.x + Math.cos(snake.angle) * speed,
        y: head.y + Math.sin(snake.angle) * speed
      };

      // Check wall collision
      if (newHead.x < snake.radius || newHead.x > game.worldSize - snake.radius ||
          newHead.y < snake.radius || newHead.y > game.worldSize - snake.radius) {
        
        if (game.type === 'freeplay') {
          // In freeplay, just mark as dead, don't drop food
          snake.isDead = true;
          io.to(gameId).emit('player-died', {
            playerId: player.id,
            canRespawn: true
          });
        } else {
          // Normal death for other modes
          snake.isDead = true;
          const droppedFood = dropFoodFromSnake(game, player);
          
          io.to(gameId).emit('player-died', {
            playerId: player.id,
            droppedFood: droppedFood,
            canRespawn: false
          });
          
          checkWinCondition(game, gameId);
        }
        return;
      }

      // Move snake
      snake.segments = [newHead, ...snake.segments.slice(0, -1)];

      // Check food collision
      const foodToRemove: string[] = [];
      game.food.forEach((food, foodId) => {
        const distance = Math.sqrt(
          Math.pow(head.x - food.position.x, 2) +
          Math.pow(head.y - food.position.y, 2)
        );
        
        if (distance < snake.radius + food.radius) {
          foodToRemove.push(foodId);
          snake.score += 5;
          snake.radius = Math.min(20, snake.radius * 1.005);
          
          // Grow snake
          const tail = snake.segments[snake.segments.length - 1];
          snake.segments.push({ ...tail });
        }
      });

      // Remove eaten food and generate new ones
      foodToRemove.forEach(foodId => {
        game.food.delete(foodId);
        const newFood = generateFood(game.worldSize);
        game.food.set(newFood.id, newFood);
        
        io.to(gameId).emit('food-eaten', {
          playerId: player.id,
          foodId: foodId,
          newFood: newFood,
          score: snake.score
        });
      });

      // Check snake collision
      playersArray.forEach((otherPlayer) => {
        if (otherPlayer.id === player.id || otherPlayer.snake.isDead) return;
        
        for (let i = 0; i < otherPlayer.snake.segments.length; i++) {
          const segment = otherPlayer.snake.segments[i];
          const distance = Math.sqrt(
            Math.pow(head.x - segment.x, 2) +
            Math.pow(head.y - segment.y, 2)
          );
          
          if (distance < snake.radius * 0.7 + otherPlayer.snake.radius * 0.7) {
            if (game.type === 'freeplay') {
              // In freeplay, killer gets points
              otherPlayer.snake.score += 50;
              otherPlayer.snake.killCount++;
              
              snake.isDead = true;
              io.to(gameId).emit('player-died', {
                playerId: player.id,
                killedBy: otherPlayer.id,
                canRespawn: true
              });
            } else {
              // Normal death for other modes
              snake.isDead = true;
              const droppedFood = dropFoodFromSnake(game, player);
              
              io.to(gameId).emit('player-died', {
                playerId: player.id,
                droppedFood: droppedFood,
                killedBy: otherPlayer.id,
                canRespawn: false
              });
              
              checkWinCondition(game, gameId);
            }
            break;
          }
        }
      });
    });
  });
}, 1000 / TICK_RATE);

// Broadcast game state
setInterval(() => {
  games.forEach((game, gameId) => {
    if (game.state !== 'playing' && game.type !== 'freeplay') return;

    const gameState = {
      players: Array.from(game.players.values()).map(p => ({
        id: p.id,
        snake: {
          segments: p.snake.segments,
          angle: p.snake.angle,
          score: p.snake.score,
          radius: p.snake.radius,
          isDead: p.snake.isDead,
          color: p.snake.color
        }
      })),
      foodCount: game.food.size
    };

    io.to(gameId).emit('game-state', gameState);
  });
}, 1000 / SEND_RATE);

// Update leaderboards
setInterval(() => {
  // Update freeplay leaderboard
  if (freePlayRoom) {
    updateLeaderboard(freePlayRoom);
    io.to('freeplay-main').emit('leaderboard-update', {
      leaderboard: freePlayRoom.leaderboard
    });
  }
}, LEADERBOARD_UPDATE_RATE);

// Server status endpoint
setInterval(() => {
  const status = {
    paid: {
      active: activePaidRoom !== null,
      players: activePaidRoom ? games.get(activePaidRoom)?.players.size || 0 : 0
    },
    casual: {
      activeRooms: activeCasualRooms.size,
      totalPlayers: Array.from(activeCasualRooms).reduce((total, roomId) => {
        const room = games.get(roomId);
        return total + (room ? room.players.size : 0);
      }, 0)
    },
    freeplay: {
      players: freePlayRoom?.players.size || 0
    }
  };
  
  io.emit('server-status', status);
}, 5000);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`SlitherMatch Game Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Accepting connections from: ${process.env.CLIENT_URL}`);
  console.log('Game modes initialized:');
  console.log('- Paid Lobby: 1 room max, 3-5 players');
  console.log('- Casual Lobby: 3 rooms max, 3-5 players each');
  console.log('- Freeplay: 1 persistent room, 30 players max');
});