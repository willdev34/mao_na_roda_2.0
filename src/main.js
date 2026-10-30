import Phaser from 'phaser'
import { OfficeScene } from './OfficeScene.js'

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1b2430',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: [OfficeScene],
})
