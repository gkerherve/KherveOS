// AI tools of the games and simulations (see ../appManifest.ts for how app tools work).
//
// The mini-games (src/apps/minigames) share three tools, implemented once in
// GameShell.tsx: get_state, new_game and play. A game adds its own numbers to
// get_state (GameShell's `aiState`) and its own tools (GameShell's `aiTools`).
// The web games (src/apps/games, iframes of their own servers) share
// get_status, restart and reload, implemented in WebGame.tsx.

import type { AppToolSet, AppToolSpec } from '../appToolsCore.ts'
import { bool, int, object, oneOf, str } from './schema.ts'

/** The tools every mini-game has (GameShell.tsx), then the game's own ones. */
function miniGame(app: string, name: string, summary: string, keywords: string[], stats: string, extra: AppToolSpec[] = []): AppToolSet {
  return {
    app,
    name,
    summary,
    keywords,
    tools: [
      {
        action: 'get_state',
        description: `Read ${name}'s state: phase (ready, playing, paused, over), score, best score, top high scores, ${stats}.`,
        inputSchema: object({}),
        readOnly: true,
      },
      {
        action: 'new_game',
        description: `Set up a fresh game of ${name} (asks the user first when a game with points is in progress). With start true it starts at once.`,
        inputSchema: object({ start: bool('Start playing straight away (default false: the start card waits).') }),
      },
      {
        action: 'play',
        description: `Start, pause or resume ${name}. Starting or resuming brings its window to the front so the player can use the keys.`,
        inputSchema: object({ action: oneOf(['start', 'pause', 'resume'], 'What to do.') }, ['action']),
      },
      ...extra,
    ],
  }
}

/** The tools every web game has (WebGame.tsx). */
function webGame(app: string, name: string, summary: string, keywords: string[]): AppToolSet {
  return {
    app,
    name,
    summary,
    keywords,
    tools: [
      {
        action: 'get_status',
        description: `Is ${name} running? Its window's phase (starting, ready, offline, signin, error), its address, and whether its own game server is up.`,
        inputSchema: object({}),
        readOnly: true,
      },
      {
        action: 'restart',
        description: `Restart ${name}'s game server (as its restart button does) and load the game again. Asks the user first: unsaved progress is lost.`,
        inputSchema: object({}),
      },
      {
        action: 'reload',
        description: `Reload ${name}'s page in its window (the game server keeps running). Asks the user first: unsaved progress is lost.`,
        inputSchema: object({}),
      },
    ],
  }
}

export const GAME_TOOL_SETS: AppToolSet[] = [
  miniGame('tetris', 'Tetris', 'the falling-blocks game.', ['tetris', 'tetromino', 'tetrominoes'], 'level, lines, held and next pieces'),
  miniGame('breakout', 'Breakout', 'the brick-breaking paddle game.', ['breakout', 'brick breaker', 'bricks'], 'level, lives, balls in play'),
  miniGame('pacman', 'Pac-Man', 'the maze game: eat the dots, dodge the ghosts.', ['pacman', 'pac-man', 'pac man', 'ghosts', 'maze'], 'level, lives, dots left, power-pellet seconds, mode, and the tiles of Pac-Man and the four ghosts'),
  miniGame('pinball', 'Pinball', 'the pinball table with flippers and bumpers.', ['pinball', 'flipper', 'flippers'], 'ball number, bonus, multiplier'),
  miniGame('asteroids', 'Meteor Smash', 'the space shooter where you blast meteors (Asteroids-like).', ['asteroids', 'meteor', 'meteors'], 'wave, lives, meteors left'),
  miniGame('flappy', 'Flappy Khervey', 'the Flappy Bird-like game: flap through pipes, shoot birds and bees.', ['flappy', 'flappy bird', 'khervey'], 'stage, difficulty', [
    {
      action: 'set_difficulty',
      description: 'Set Flappy Khervey\'s difficulty (faster pipes, narrower gaps, more enemies). Only between games: before starting or after game over.',
      inputSchema: object({ difficulty: oneOf(['easy', 'medium', 'hard'], 'The difficulty.') }, ['difficulty']),
    },
  ]),
  miniGame(
    'solitaire',
    'Solitaire',
    'Klondike solitaire, drawing one card at a time.',
    ['solitaire', 'card game', 'klondike', 'patience'],
    'moves, time, and the table (stock, waste, foundations, the 7 columns with face-down counts)',
    [
      {
        action: 'move',
        description:
          'Move cards in Solitaire, e.g. from "column 3" to "foundation", or from "waste" to "column 5". From a column, "card" picks a face-up card ' +
          '(e.g. "7H" or "7♥") to move with the cards on it (default: the top card). "to" may be "auto": where a click would send it.',
        inputSchema: object(
          {
            from: str('"waste", "column 1".."column 7", or "foundation 1".."foundation 4".'),
            to: str('"foundation" (any that fits), "foundation 1".."4", "column 1".."7", or "auto".'),
            card: str('From a column: the face-up card to move with those on it, e.g. "10D", "Q♠" (default: the top card).'),
          },
          ['from', 'to'],
        ),
      },
      {
        action: 'action',
        description: 'Solitaire actions: "draw" turns up the next stock card (or turns the waste over), "undo" takes back a move, "auto" sends a card up to a foundation, "give_up" ends the game (asks the user).',
        inputSchema: object({ action: oneOf(['draw', 'undo', 'auto', 'give_up'], 'What to do.') }, ['action']),
      },
    ],
  ),
  miniGame(
    'electrons',
    'Electron Game',
    'the atom simulation: add electrons round a nucleus and keep it stable.',
    ['electron game', 'electrons game', 'atom game'],
    'electrons, stability, decay meter, time left',
    [
      {
        action: 'set_electrons',
        description:
          'Set how many electrons the Electron Game\'s atom has (2–24): adds new ones round the nucleus or takes the newest away. Starts the experiment if needed.',
        inputSchema: object(
          {
            count: int('Electrons wanted, 2 to 24.'),
            distance: int('How far from the nucleus new electrons appear, 20–190 (default 100; far ones shake the atom more).'),
          },
          ['count'],
        ),
      },
    ],
  ),
  miniGame(
    'materiallab',
    'Material Lab',
    'the chemistry lab: mix elements, heat the furnace, discover 44 compounds.',
    ['material lab', 'materiallab', 'chemistry lab', 'reactor', 'furnace'],
    'reactor contents and temperature, furnace, unlocked elements, discovered compounds',
    [
      {
        action: 'set_furnace',
        description: 'Set Material Lab\'s furnace: fuel level 0–10 (each level adds 100 °C to the room\'s 25 °C while it is on) and on / off.',
        inputSchema: object({ fuel: int('Fuel level, 0 to 10.'), on: bool('Furnace on (it only lights with some fuel).') }),
      },
      {
        action: 'experiment',
        description:
          'Run a Material Lab experiment: empty the reactor, put in the atoms of a formula (e.g. "H2O" = 2 H + 1 O, "NaCl"), optionally set the fuel (turning the furnace on), ' +
          'wait for the temperature, and react. Returns what happened.',
        inputSchema: object(
          {
            elements: str('The atoms, as a formula: "H2O", "NaCl", "CaC2", "Fe S".'),
            fuel: int('Fuel level 0–10 to set first (furnace on if above 0). Default: keep the furnace as it is.'),
          },
          ['elements'],
        ),
      },
    ],
  ),
  webGame('planetcraft', 'PlanetCraft', 'the voxel planet game (runs on its own game server).', ['planetcraft', 'planet craft', 'voxel']),
  webGame('simai', 'SimAI', 'the village simulation that lives by itself (runs on its own game server).', ['simai', 'sim ai', 'village sim']),
  webGame('madsci', 'Mad Scientist SIM', 'the university department simulation: groups compete for grants, papers and fame (runs on its own game server).', ['mad scientist', 'madsci', 'department sim', 'lab sim']),
  webGame('facecraft', 'FaceCraft', 'turns a photo into a Minecraft skin (runs on its own server).', ['facecraft', 'face craft', 'minecraft skin', 'skin maker']),
]
