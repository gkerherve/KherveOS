// Wobbleland: a full-screen pinball on an amusement park at night. A big
// table with a looping roller coaster, a Ferris wheel that locks balls for
// multiball, teacup bumpers, a high striker, a shooting gallery and a
// carousel, between the backglass with its dot-matrix display and the rides
// board. The rules are in parkRules.ts, the drawing and sounds in
// parkEngine.ts (still artwork in parkArt.ts, music in parkMusic.ts); this
// is the window, on the shared game shell (with no side panel: the screen
// shows everything).

import { useEffect, useState } from 'react'
import type { AppProps } from '@/os'
import { GameShell, useScores, type GameInfo } from './GameShell'
import { H, WobblelandEngine, W } from './parkEngine'
import { RIDES } from './parkRules'

const INFO: GameInfo = {
  id: 'wobbleland',
  name: 'Wobbleland',
  width: W,
  height: H,
  step: 1 / 240,
  fullscreen: true,
  noPanel: true,
  hideCursor: true,
  controls: [
    ['Z ⇧ ←', 'Left flipper'],
    ['/ ⇧ →', 'Right flipper'],
    ['Space', 'Hold, then let go to shoot'],
    ['F', 'Full screen'],
  ],
  help: (
    <>
      <h4>Goal</h4>
      <p>A night at the amusement park: ride all six rides with three balls, and score as much as you can on the way.</p>
      <h4>Controls</h4>
      <ul>
        <li>Left flipper: <kbd className="mg-key">Z</kbd>, left <kbd className="mg-key">Shift</kbd> or <kbd className="mg-key">←</kbd></li>
        <li>Right flipper: <kbd className="mg-key">/</kbd>, right <kbd className="mg-key">Shift</kbd> or <kbd className="mg-key">→</kbd></li>
        <li>Plunger: hold <kbd className="mg-key">Space</kbd> (or <kbd className="mg-key">↓</kbd>) and let go — the longer you hold, the harder the shot</li>
        <li><kbd className="mg-key">F</kbd> full screen (a game starts in full screen), <kbd className="mg-key">P</kbd> pause, <kbd className="mg-key">M</kbd> sound</li>
      </ul>
      <h4>The rides</h4>
      <ul>
        <li><b>Roller Coaster</b>: shoot the loop ramp on the left hard; the ball rides the track, loops the loop and comes back to your left flipper. Three rides. Straight after an inlane it's a <b>combo</b>, worth double.</li>
        <li><b>Ferris Wheel</b>: the scoop under the wheel locks a ball in a gondola. Lock three for <b>multiball</b>: every scoop is then a jackpot.</li>
        <li><b>Teacups</b>: the three pop bumpers, going round on their turntable. Thirty spins.</li>
        <li><b>Runaway balloon</b>: a balloon drifts across the upper playfield, faster each time. Pop it for 5,000, then 10,000… up to 25,000; every fifth pop pays a 50,000 bonus.</li>
        <li><b>High Striker</b>: hit the red pad from below, hard, to send the puck up the tower and ring the bell.</li>
        <li><b>Shooting Gallery</b>: knock down all four ducks on the right.</li>
        <li><b>Carousel</b>: the turntable in the middle swings the ball round; stay on it for five seconds.</li>
      </ul>
      <h4>More</h4>
      <ul>
        <li><b>P·A·R·K</b> lanes at the top raise the bonus multiplier (up to 6×); the flippers move the lit lanes. Plunge into the blinking lane for the <b>skill shot</b>.</li>
        <li><b>T·I·X</b> targets on the left give tickets; all three light <b>Ride Again</b> (the ball save) once more.</li>
        <li>Three rides done: <b>extra ball</b>. All six: the <b>Grand Finale</b>, a multiball with bigger jackpots.</li>
      </ul>
    </>
  ),
}

export default function Wobbleland({ win }: AppProps) {
  const [engine] = useState(() => new WobblelandEngine())
  const scores = useScores(INFO.id)
  engine.best = scores[0]?.score ?? 0

  useEffect(() => () => engine.dispose(), [engine])

  const aiState = () => {
    const g = engine.game
    return {
      ball: g.ballNumber,
      rides_done: g.ridesDone,
      rides: Object.fromEntries(RIDES.map((r) => [r, g.done[r] ? 'done' : `${g.progress[r]}`])),
      multiplier: g.multiplier,
      tickets: g.tickets,
      locked: g.locked,
      multiball: g.multiball,
      grand_finale: g.finale,
      extra_balls: g.extraBalls,
      ball_save: g.saveTime > 0,
    }
  }

  return <GameShell win={win} info={INFO} engine={engine} panel={null} aiState={aiState} className="mg-park" />
}
