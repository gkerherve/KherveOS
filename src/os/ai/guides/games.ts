// Guides of the games. The mini-games share three tools (get_state, new_game,
// play: src/os/ai/manifests/games.ts); the web games run on their own servers
// (get_status, restart, reload).

import type { AppGuide } from './core.ts'

/** A mini-game: one guide shape for all of them. */
function miniGame(app: string, use: string, about: string, concepts: string[], extra: string[] = [], playedByTools = false): AppGuide {
  return {
    app,
    use,
    about,
    concepts: [
      playedByTools
        ? 'It can be played from the tools (see below); `' + app + '_play` starts, pauses or resumes and brings the window to the front.'
        : 'The player uses the keyboard in the window: `' + app + '_play` with start or resume brings the window to the front. You cannot press keys, only read the state and start, pause or resume.',
      ...concepts,
    ],
    workflow: [
      '`' + app + '_get_state`: phase (ready, playing, paused, over), score, best score, high scores, game details.',
      '`' + app + '_new_game` (asks first if a game with points is in progress; start=true begins at once), then `' + app + '_play` with action start, pause or resume.',
      ...extra,
    ],
    pitfalls: ['Do not start a new game over a game in progress unless asked: the score is lost.'],
  }
}

/** A web game on its own server (PlanetCraft, SimAI, Mad Scientist SIM, FaceCraft). */
function webGame(app: string, use: string, about: string, concepts: string[] = []): AppGuide {
  return {
    app,
    use,
    about,
    concepts: [
      'It runs on its own game server that KherveOS starts; the game itself is played in its window by the user. The tools only manage the server and the page.',
      ...concepts,
    ],
    workflow: [
      '`' + app + '_get_status`: phase (starting, ready, offline, signin, error), address, whether the server is up.',
      'If offline or in error: `' + app + '_restart` restarts the game server; if the page is blank: `' + app + '_reload` (both ask first because unsaved progress is lost).',
    ],
    pitfalls: ['Restart and reload lose unsaved progress: they ask the user.'],
  }
}

export const GAME_GUIDES: AppGuide[] = [
  miniGame('tetris', 'Falling-blocks puzzle', 'Stack the falling blocks and clear lines.', ['The state has the level, lines, and the held and next pieces.']),
  miniGame('breakout', 'Brick-breaking paddle game', 'Knock out every brick with the ball.', ['The state has the level, lives and balls in play.']),
  miniGame('pacman', 'Maze game: dots, ghosts and power pellets', 'Eat every dot, dodge the ghosts and grab the power pellets.', [
    'The state has the level, lives, dots left, power-pellet seconds, the mode, and the tiles of Pac-Man and the four ghosts.',
  ]),
  miniGame('pinball', 'Pinball table with flippers and bumpers', 'Flippers, bumpers and a plunger: keep the ball in play.', ['The state has the ball number, bonus and multiplier.']),
  miniGame('asteroids', 'Space shooter: blast meteors (Asteroids-like)', 'Steer your ship and blast the meteors to pieces.', ['The state has the wave, lives and meteors left.']),
  miniGame('runekeep', 'DataCenter Assault: fast first-person shooter in a military data centre', 'Three levels of corridors, server halls and plant rooms: soldiers, dogs, drones and heavies, then androids; blue and red keycards, sliding, shutter, double and blast doors. In the last level every core server must be destroyed before the exit opens. Ten weapons, from the knife to the railgun.', [
    'It needs the mouse: `runekeep_play` brings the window to the front, but only the player\'s click starts or resumes. Pausing works from the tools.',
    'The state has the level, stage (play, dead, intermission, finished), health, armor, weapon and ammo, weapons owned, keys, kills, secrets and time.',
    'It is an original game in that style: none of Quake\'s maps, models, textures, sounds or names.',
  ]),
  miniGame('lasttrain', '3D subway zombie shooter (first person)', 'Hold a subway station against zombie waves; when a wave is cleared a train pulls in, the player boards any of its three cars and rides to the next station for a harder wave. The street gates are chained shut (a crowd claws at them) until the last station, Pyodide Park: clear its wave, climb the stairs and walk out to win.', [
    'A staff door on each landing leads up to a ticket hall behind ticket gates; zombies also come in through its shutter. Bloaters burst (hurting everything near), spitters lob acid. A new gun is found at each station (SMG, .44, Auto-12, DMR): keys 1–7, Q or the wheel.',
    'It needs the mouse (pointer lock): `lasttrain_play` brings the window to the front, but only the player\'s click starts or resumes. Pausing works from the tools.',
    'The state has the wave, station, stage (fight, cleared, trainIn, board, depart, arrive, alight, exit, escaped, dying), health, weapon, ammo, enemies left and kills.',
  ]),
  miniGame('grandprix', '3D motor racing game: modern single-seaters or 1970s classic coupés (qualifying, race, pit stops)', 'Pick the cars (modern single-seaters or 1970s-style classic coupés), a circuit (Kherve Park or Lac Bleu), race and qualifying length, rival difficulty and assists. Qualifying: the best lap sets the grid. Race: five red lights, tyres that wear, P to box for new tyres (1 · 2 · 3 picks the compound), DRS on the long straights, the chequered flag.', [
    'Twelve cars in six teams; the player drives car 7 for Kherve Racing (black and green), the team with the two transporter trucks in the paddock.',
    'The Classics (fictional makes, balanced to the same pace): the Stoccarda 901 RS fastback, the little Dieppe A110 berlinette, the Bavaria 30 CS touring coupé; the player picks one.',
    'Controls: X throttle, Z brake (the arrows work too), Space the handbrake to start a drift (then throttle and countersteer; the assists let it slide but stop a spin), E DRS, P box, V view (camera). A tap of a steering key turns a little; holding it turns more. With the assists off, braking hard while turning in also swings the tail out. The assists (on by default) add a cornering assist: the player\'s tyres grip a quarter more.',
    'Damage (menu, on by default): hitting a wall or a car breaks the front wing (nose on a classic), the rear wing (tail) or the suspension, costing grip and downforce; a pit stop (P) repairs it, adding a few seconds. The state reports it.',
    'Light (menu): the circuit\'s own (midday at Kherve Park, golden afternoon at Lac Bleu) or Sunset: the sun on the horizon, lit windows and lamp posts.',
    'The Classics are slower (no downforce, about 240 km/h flat out), slide more and have no DRS; with the assists off the rear-engined Stoccarda is tail-happy.',
    'In races of 3 laps or more both a second compound and so a pit stop are required, or 10 s is added. A jump start costs 5 s. In qualifying, leaving the track deletes the lap.',
    'The state has the stage (menu, qualifying, qualiResults, race, raceResults), the cars (series), the track, the session, position, lap, best and last lap, tyres and wear, the next compound, the pit state, the top five and the last results.',
    'The score of a race: points for the finishing place (25, 18, 15… ×100, ×1.5 on Medium, ×2 on Hard), +300 for pole, +200 for the fastest lap, +50 a place gained.',
  ], ['`grandprix_play` with start on the menu starts qualifying with the menu\'s settings; the player drives with the keyboard or a gamepad.']),
  miniGame('flappy', 'Flappy-Bird-like game with shooting', 'Flap through the pipes and shoot the birds and bees.', ['The state has the stage and difficulty.'], [
    '`flappy_set_difficulty` (easy, medium, hard) only between games: before starting or after game over.',
  ]),
  miniGame(
    'solitaire',
    'Klondike solitaire, one card at a time',
    'Klondike: build the four suits from ace to king, drawing one card at a time.',
    ['The state has the moves, time and the table: stock, waste, foundations and the 7 columns with their face-down counts.'],
    [
      '`solitaire_move` from "waste", "column 1".."column 7" or "foundation 1".."4" to "foundation", a column or "auto" (card picks a face-up card to move with the cards on it, e.g. "7H").',
      '`solitaire_action` draw, undo, auto (send a card up) or give_up (asks the user).',
    ],
    true,
  ),
  miniGame('electrons', 'Atom game: add electrons, keep the atom stable', 'Add electrons round a nucleus and keep the atom stable.', ['The state has the electrons, stability, decay meter and time left.'], [
    '`electrons_set_electrons` sets 2 to 24 electrons (and how far from the nucleus new ones appear, 20–190: far ones shake the atom more); it starts the experiment if needed.',
  ]),
  miniGame('materiallab', 'Chemistry game: mix elements, heat, discover 44 compounds', 'Mix elements, heat the furnace and discover 44 compounds.', [
    'The state has the reactor contents and temperature, the furnace, unlocked elements and discovered compounds. Fuel 0–10 adds 100 °C per level to the room\'s 25 °C.',
  ], [
    '`materiallab_experiment` with a formula ("H2O", "NaCl", "Fe S") empties the reactor, puts those atoms in, optionally sets the fuel, waits for the temperature and reacts; `materiallab_set_furnace` sets fuel and on / off.',
  ]),
  miniGame(
    'reactionchain',
    'Chemistry puzzle: drop atoms, make molecules, chain reactions',
    'Atoms drop into a 7 × 10 rack; a connected group (left/right or above/below) holding exactly the atoms of a molecule reacts and leaves, and what falls can set off a chain.',
    [
      'The state lists the rack as columns bottom first, the current and next atoms, the target (triple points) and the molecules in play with their atoms. Points: 10 × atoms² × chain step.',
      'Levels: 1 H, O (H₂O, H₂O₂); 2 adds C (CO, CO₂, CH₄); 3 N (NH₃, HCN, NO₂); 4 Na, Cl (NaCl, HCl, NaOH); 5 S (H₂S, SO₂, SO₃). A level every 8 molecules.',
    ],
    [
      '`reactionchain_drop` with a column 1–7 drops the current atom and resolves the chain at once; plan with the returned columns. Bigger molecules win when several could form (CO₂ before CO).',
    ],
    true,
  ),
  miniGame(
    'molbuilder',
    'Isomer puzzle: build every isomer of a formula',
    'Each level gives a formula (CH₄ up to C₄H₁₀O) and how many structural isomers it has; build them all before time runs out. Hydrogens are implicit: C takes 4 bonds, N 3, O 2.',
    [
      'Formulas are in Hill order (C, H, then others): hydrogen cyanide is "CHN". The state lists the isomers found and the formula on the board.',
      'Isomers are compared by their graph, so the same molecule drawn twice counts once; cis/trans are one.',
    ],
    [
      '`molbuilder_build` with SMILES ("CCO", "COC", "C1CC1", "C=C(C)C") puts the structure on the board and checks it; when all isomers are found the next level starts.',
    ],
    true,
  ),
  miniGame(
    'titrationrush',
    'Acid–base titration game against the clock',
    'Ten titrations: add NaOH (or HCl for a base) until the indicator turns, then call the end point. Points for closeness to the equivalence point (1000 at 0 mL error, 0 at 1 mL) plus 5 per second left.',
    [
      'Rounds 1–4 show the pH; from round 5 there is no pH, and the indicator is chosen first (+200 when it turns within 0.1 mL of equivalence).',
      'Indicators: methyl orange pH 2.7–4.7, methyl red 4.1–6.1, bromothymol blue 6.1–8.1, phenolphthalein 8.3–10.3. Weak acid → phenolphthalein; weak base (NH₃) → methyl red; strong–strong → any but methyl orange is borderline.',
    ],
    [
      '`titrationrush_choose_indicator` (rounds 5–10), then `titrationrush_add` in steps (big ones far from the end, 0.05 mL near it), `titrationrush_end_point`, `titrationrush_next`.',
      'The concentration is unknown, but in training rounds the pH jump shows where equivalence is.',
    ],
    true,
  ),
  webGame('planetcraft', 'Voxel planet to walk, dig and build on', 'A voxel planet to walk, dig and build on. Runs on its own game server (port 8123).'),
  webGame('simai', 'Village simulation that lives by itself', 'A village that lives by itself. Runs on its own game server (port 8137).'),
  webGame('madsci', 'University-department simulation', 'A university department that lives by itself: groups compete for grants, papers and fame. Runs on its own game server.'),
  webGame('facecraft', 'Turn a photo into a Minecraft skin', 'Turn a photo into a Minecraft skin. Runs on its own server (port 8140).'),
]
