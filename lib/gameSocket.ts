import { io, Socket } from 'socket.io-client';

class GameSocket {
  private socket: Socket | null = null;
  private currentGameId: string | null = null;

  connect(serverUrl: string = process.env.NEXT_PUBLIC_GAME_SERVER || 'http://localhost:3001') {
    this.socket = io(serverUrl, {
      transports: ['websocket'],
      upgrade: false
    });

    this.socket.on('connect', () => {
      console.log('Connected to game server');
    });
  }

  // Find game based on type
  findGame(gameType: 'paid' | 'casual' | 'freeplay', playerInfo: any) {
    if (!this.socket) return;
    this.socket.emit('find-game', { gameType, playerInfo });
  }

  // Respawn in freeplay
  respawn(username?: string) {
    if (!this.socket) return;
    this.socket.emit('respawn', { username });
  }

  // Movement
  sendMovement(angle: number) {
    if (!this.socket) return;
    this.socket.emit('move', { angle });
  }

  // Event listeners
  onGameJoined(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('game-joined', (data) => {
      this.currentGameId = data.gameId;
      callback(data);
    });
  }

  onGameUnavailable(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('game-unavailable', callback);
  }

  onGameState(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('game-state', callback);
  }

  onLeaderboardUpdate(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('leaderboard-update', callback);
  }

  onPlayerDied(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('player-died', callback);
  }

  onGameEnded(callback: (data: any) => void) {
    if (!this.socket) return;
    this.socket.on('game-ended', callback);
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export const gameSocket = new GameSocket();