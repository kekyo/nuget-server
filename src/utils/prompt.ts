// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import * as readline from "readline";

/**
 * Prompts for user input with optional default value
 */
export const promptInput = (
  rl: readline.Interface,
  prompt: string,
  defaultValue?: string,
): Promise<string> => {
  return new Promise((resolve) => {
    const displayPrompt = defaultValue
      ? `${prompt} [${defaultValue}]: `
      : `${prompt}: `;
    rl.question(displayPrompt, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
};

/**
 * Prompts for password input (hidden)
 */
export const promptPassword = (prompt: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Check if we're in an interactive terminal
    if (!process.stdin.isTTY) {
      // Non-interactive mode: read from stdin without masking
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });

      process.stdout.write(`${prompt}: `);

      rl.once("line", (input) => {
        process.stdout.write("\n");
        rl.close();
        resolve(input);
      });

      return;
    }

    // Interactive mode: mask password input
    // Don't create readline interface to avoid echo conflicts
    process.stdout.write(`${prompt}: `);

    // Set raw mode to hide input completely
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let password = "";

    const onData = (chunk: Buffer) => {
      const str = chunk.toString("utf8");

      // Handle multiple characters (e.g., from paste)
      for (let i = 0; i < str.length; i++) {
        const char = str[i];

        switch (char) {
          case "\u0003": // Ctrl+C
            process.stdout.write("\n");
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener("data", onData);
            reject(new Error("Cancelled by user"));
            return;

          case "\r":
          case "\n": // Enter
            process.stdout.write("\n");
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener("data", onData);
            resolve(password);
            return;

          case "\u007F": // Backspace (DEL)
          case "\b": // Backspace (BS)
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write("\b \b"); // Move back, write space, move back again
            }
            break;

          default:
            // Only accept printable characters
            if (char && char.charCodeAt(0) >= 32 && char.charCodeAt(0) < 127) {
              password += char;
              process.stdout.write("*");
            }
            break;
        }
      }
    };

    process.stdin.on("data", onData);
  });
};

/**
 * Prompts for yes/no confirmation
 */
export const promptConfirm = (
  rl: readline.Interface,
  prompt: string,
  defaultValue: boolean = false,
): Promise<boolean> => {
  return new Promise((resolve) => {
    const defaultStr = defaultValue ? "Y/n" : "y/N";
    rl.question(`${prompt} [${defaultStr}]: `, (answer) => {
      const normalized = answer.trim().toLowerCase();
      if (normalized === "") {
        resolve(defaultValue);
      } else {
        resolve(normalized === "y" || normalized === "yes");
      }
    });
  });
};
