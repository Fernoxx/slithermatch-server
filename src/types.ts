export interface Position {
  x: number;
  y: number;
}

export interface Snake {
  id: string;
  segments: Position[];
  angle: number;
  score: number;
  radius: number;
  color: string;
  isDead: boolean;
  killCount: number;
}

export interface Player {
  id: string;
  socketId: string;
  address: string;
  username: string;
  profilePic?: string;
  snake: Snake;
  lastUpdate: number;
  joinedAt: number;
}

export interface Food {
  id: string;
  position: Position;
  color: string;
  radius: number;
}

export interface GameRoom {
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