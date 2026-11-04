// A key code's words on a key cap ("KeyG" is "G", "ArrowUp" is "↑", "Numpad1" is "Num 1"), alone in its file: the options' Keys settings and help lines,
// and the emotes wheel's key cap, use the same words, and the wheel loads none of the options' other code.

/** The words for a `KeyboardEvent.code` on a key cap: "KeyE" is "E", "Digit1" is "1", "ArrowUp" is "↑", "ShiftLeft" is "Shift". */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
    Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", ShiftLeft: "Shift", ShiftRight: "Right Shift", ControlLeft: "Ctrl",
    ControlRight: "Right Ctrl", AltLeft: "Alt", AltRight: "Right Alt", MetaLeft: "Cmd", MetaRight: "Right Cmd", Enter: "Enter", Space: "Space", Backspace: "Backspace", CapsLock: "Caps Lock",
  };
  return named[code] ?? code;
}
