# Midnight Express – The Last Train

A 2D arcade game built with HTML5, CSS3 and vanilla JavaScript (Canvas and Web Audio). It uses no libraries, image files, sound files or external APIs. Every graphic is drawn in code and every sound is generated.

## Objective
Survive as long as possible on a midnight railway, collect points and reach higher levels.

## Controls

| Key | Action |
|---|---|
| ← / A and → / D | Switch lane (animated) |
| Space | Emergency brake |
| P or Esc | Pause and resume |
| W | Whistle |
| Enter | Start from the menu or after game over |

Swipe left or right on the game, or tap the left or right quarter, to change lanes. Tap the middle to whistle.

On touch screens, ◀ BRAKE ▶ buttons appear while playing.

## Collectibles

| Item | Effect |
|---|---|
| Golden ticket | +10 points |
| Gold coin (groups of three) | +5 points |
| Fuel can | +15 points and +20% fuel |
| Green signal token | +20 points and +35% brake energy |

## Hazards
Broken track covers a stretch of lane, rocks sit in one lane, and ghost trains appear from level 2 and sometimes switch lanes. Each hit costs one life. After a hit you are invulnerable for 1.2 seconds. Fuel also burns over time, and an empty tank ends the run.

## Emergency brake (main customization)
- Brake energy starts at 100%. Each brake costs 35%.
- Braking lasts 2 seconds and cuts the world speed to 35%. This changes how fast obstacles reach you.
- A 1.5-second cooldown follows. You cannot brake while braking or cooling down, or with less than 35% energy.
- Green signal tokens restore 35% energy.

## Difficulty
The level rises with score and survival time, up to level 6. Higher levels increase world speed, shorten the gaps between spawns, add more hazards and broken tracks, and make ghost trains faster and more likely to change lanes. The spawner never fills two lanes with hazards near the train, so every situation can be survived.

## Technical implementation
- **index.html**: canvas, HUD panels, touch buttons and the menu, how-to, pause and game-over screens.
- **style.css**: midnight palette, glass-style panels, buttons and animations.
- **game.js**: a `requestAnimationFrame` loop with delta time, arrays of objects, collision by lane and depth, a state machine (menu, playing, paused, over), Web Audio sound effects and localStorage for the high score (key `midnightHigh`).

Main functions: `startGame`, `updateGame`, `drawGame`, `moveTrain`, `spawnObject`, `updateObjects`, `detectCollision`, `collectItem`, `activateEmergencyBrake`, `updateDifficulty`, `pauseGame`, `resumeGame`, `gameOver`, `restartGame`.

## Algorithm in simple English
1. Show the menu and keep the scenery moving.
2. On start, reset the score, lives, fuel and brake.
3. Each frame, measure the time since the last frame and move the world by that amount.
4. Spawn new objects on a timer and move all objects towards the train.
5. Check whether the train touches any object in its lane. Collect it or lose a life.
6. Update fuel, level and brake timers, then draw the scene.
7. When lives or fuel run out, show the game-over screen and save the high score.

## Collision example
The train is in the middle lane. A rock is also in the middle lane and reaches the same depth as the train. The lanes match and the depth difference is less than 0.05, so `hitPlayer()` removes one life and starts the invulnerability timer.

## How to run
1. Open the `Midnight-Express` folder in VS Code.
2. Install the **Live Server** extension.
3. Right-click `index.html` and choose **Open with Live Server**.

## Deploy on Netlify
Go to app.netlify.com/drop and drag the `Midnight-Express` folder onto the page. The game is static, so no build step is needed.

## Assets
The `assets/` folders are reserved for images, sounds and fonts. Sounds are generated in code, so these folders are empty.

## Lab demonstration checklist
- [ ] Train moves across three lanes
- [ ] Ticket collection increases the score
- [ ] Fuel can restores the fuel meter
- [ ] A hit reduces lives and shows the damage flash
- [ ] Space slows the train and the scenery for 2 seconds
- [ ] Green token restores brake energy
- [ ] Level increases as the game gets harder
- [ ] Game over shows the results, and restart works
