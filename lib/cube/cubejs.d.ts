declare module 'cubejs' {
  export default class Cube {
    constructor();
    static random(): Cube;
    static fromString(facelets: string): Cube;
    static initSolver(): void;
    move(alg: string): Cube;
    asString(): string;
    solve(maxDepth?: number): string;
    isSolved(): boolean;
  }
}
