declare module "@mariozechner/pi-tui" {
  export class Text {
    constructor(text: string, x: number, y: number);
    render(width: number): unknown;
    invalidate(): void;
  }
}
