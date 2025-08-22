// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import * as readline from 'readline';
import { join } from 'path';
import { access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import { createUserService } from './services/userService';
import { Logger } from './types';

/**
 * Options for auth initialization
 */
export interface AuthInitOptions {
  configDir: string;
  logger: Logger;
}

/**
 * Prompts for user input with optional default value
 */
const promptInput = (rl: readline.Interface, prompt: string, defaultValue?: string): Promise<string> => {
  return new Promise((resolve) => {
    const displayPrompt = defaultValue ? `${prompt} [${defaultValue}]: ` : `${prompt}: `;
    rl.question(displayPrompt, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
};

/**
 * Prompts for password input (hidden)
 */
const promptPassword = (prompt: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Check if we're in an interactive terminal
    if (!process.stdin.isTTY) {
      // Non-interactive mode: read from stdin without masking
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
      });
      
      process.stdout.write(`${prompt}: `);
      
      rl.once('line', (input) => {
        process.stdout.write('\n');
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
    
    let password = '';
    
    const onData = (char: Buffer) => {
      const str = char.toString();
      
      switch (str) {
        case '\u0003': // Ctrl+C
          process.stdout.write('\n');
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          reject(new Error('Cancelled by user'));
          break;
          
        case '\r':
        case '\n': // Enter
          process.stdout.write('\n');
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          resolve(password);
          break;
          
        case '\u007F': // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b'); // Move back, write space, move back again
          }
          break;
          
        default:
          // Only accept printable characters
          if (str.charCodeAt(0) >= 32 && str.charCodeAt(0) < 127) {
            password += str;
            process.stdout.write('*');
          }
          break;
      }
    };
    
    process.stdin.on('data', onData);
  });
};

/**
 * Check if users.json already exists
 */
const checkUsersFileExists = async (configDir: string): Promise<boolean> => {
  const usersFilePath = join(configDir, 'users.json');
  try {
    await access(usersFilePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Ensure config directory exists
 */
const ensureConfigDir = async (configDir: string): Promise<void> => {
  try {
    await access(configDir, constants.F_OK);
  } catch {
    // Directory doesn't exist, create it
    await mkdir(configDir, { recursive: true });
  }
};

/**
 * Run authentication initialization
 */
export const runAuthInit = async (options: AuthInitOptions): Promise<void> => {
  const { configDir, logger } = options;
  
  logger.info('Initializing authentication...');
  
  try {
    // Check if users.json already exists
    if (await checkUsersFileExists(configDir)) {
      logger.error('users.json already exists. Please remove it first to initialize authentication.');
      process.exit(1);
    }
    
    // Ensure config directory exists
    await ensureConfigDir(configDir);
    logger.debug(`Using config directory: ${configDir}`);
    
    // Create readline interface for regular input
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    try {
      // Prompt for username
      const username = await promptInput(rl, 'Enter admin username', 'admin');
      
      if (!username) {
        logger.error('Username cannot be empty');
        process.exit(1);
      }
      
      // Close readline interface before password input
      rl.close();
      
      // Prompt for password (with masking)
      let password: string;
      let confirmPassword: string;
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          password = await promptPassword('Enter password');
          
          if (!password || password.length < 4) {
            logger.error('Password must be at least 4 characters long');
            attempts++;
            continue;
          }
          
          confirmPassword = await promptPassword('Confirm password');
          
          if (password !== confirmPassword) {
            logger.error('Passwords do not match. Please try again.');
            attempts++;
            continue;
          }
          
          break; // Passwords match, exit loop
        } catch (error: any) {
          if (error.message === 'Cancelled by user') {
            logger.info('Authentication initialization cancelled.');
            process.exit(0);
          }
          throw error;
        }
      }
      
      if (attempts >= maxAttempts) {
        logger.error('Maximum password attempts exceeded.');
        process.exit(1);
      }
      
      // Create user service
      const userService = createUserService({ configDir, logger });
      await userService.initialize();
      
      // Create admin user
      logger.info('Creating admin user...');
      const result = await userService.createUser({
        username,
        password: password!,
        role: 'admin'
      });
      
      // Display success message and API key
      console.log('\n' + '='.repeat(60));
      console.log('Admin user created successfully!');
      console.log('='.repeat(60));
      console.log(`Username: ${result.user.username}`);
      console.log(`API Key: ${result.apiKey}`);
      console.log('='.repeat(60));
      console.log('\nIMPORTANT: Save this API key securely. It cannot be retrieved again.');
      console.log('Use this API key for NuGet client authentication:');
      console.log(`  Username: ${result.user.username}`);
      console.log(`  Password: ${result.apiKey}`);
      console.log('='.repeat(60) + '\n');
      
      logger.info('Authentication initialization completed.');
      
      // Clean up
      userService.destroy();
      
    } catch (error: any) {
      rl.close();
      throw error;
    }
    
  } catch (error: any) {
    logger.error(`Authentication initialization failed: ${error.message}`);
    process.exit(1);
  }
};