import Phaser from 'phaser';
import { isTouchDevice, isMobileDevice } from '../utils/device.js';
import { getUIScale } from '../utils/layout.js';

/**
 * TouchControls
 * Joystick virtual + botón de pausa para dispositivos táctiles.
 */
export default class TouchControls {
  constructor(scene) {
    this.scene = scene;
    this.enabled = isTouchDevice() || isMobileDevice();
    this.moveVector = { x: 0, y: 0 };
    this.actionPause = false;
    this.joystickBase = null;
    this.joystickThumb = null;
    this.pauseButton = null;
    this.pointerId = null;
  }

  create() {
    if (!this.enabled) return;

    const uiScale = getUIScale(this.scene);
    const radius = 60 * uiScale;
    const thumbRadius = 28 * uiScale;

    const padding = 90 * uiScale;
    const bottomY = this.scene.scale.height - padding;

    // Joystick en esquina inferior izquierda
    const joyX = padding;
    const joyY = bottomY;

    this.joystickBase = this.scene.add.circle(joyX, joyY, radius, 0x000000, 0.35).setScrollFactor(0).setDepth(1000);
    this.joystickBase.setStrokeStyle(2, 0x00ffff, 0.8);

    this.joystickThumb = this.scene.add.circle(joyX, joyY, thumbRadius, 0x00ffff, 0.6).setScrollFactor(0).setDepth(1001);

    // Botón de pausa en esquina inferior derecha
    const pauseX = this.scene.scale.width - padding;
    const pauseY = bottomY;

    this.pauseButton = this.scene.add.circle(pauseX, pauseY, 38 * uiScale, 0x000000, 0.45).setScrollFactor(0).setDepth(1000);
    this.pauseButton.setStrokeStyle(2, 0xff00ff, 0.9);

    this.pauseLabel = this.scene.add.text(pauseX, pauseY, 'II', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${22 * uiScale}px`,
      color: '#ff00ff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);

    this.scene.input.on('pointerdown', this.handlePointerDown, this);
    this.scene.input.on('pointermove', this.handlePointerMove, this);
    this.scene.input.on('pointerup', this.handlePointerUp, this);
  }

  destroy() {
    if (!this.enabled) return;
    this.scene.input.off('pointerdown', this.handlePointerDown, this);
    this.scene.input.off('pointermove', this.handlePointerMove, this);
    this.scene.input.off('pointerup', this.handlePointerUp, this);
    this.joystickBase?.destroy();
    this.joystickThumb?.destroy();
    this.pauseButton?.destroy();
    this.pauseLabel?.destroy();
  }

  handlePointerDown(pointer) {
    if (!this.enabled) return;
    const { x, y } = pointer;

    // ¿Toca botón de pausa?
    if (this.pauseButton && Phaser.Geom.Circle.Contains(this.pauseButton.geom, x, y)) {
      this.actionPause = true;
      return;
    }

    // Joystick: solo un pointer activo
    if (this.pointerId === null && x < this.scene.scale.width / 2) {
      this.pointerId = pointer.id;
      this.updateJoystick(pointer);
    }
  }

  handlePointerMove(pointer) {
    if (!this.enabled) return;
    if (this.pointerId !== null && pointer.id === this.pointerId) {
      this.updateJoystick(pointer);
    }
  }

  handlePointerUp(pointer) {
    if (!this.enabled) return;
    if (this.pointerId !== null && pointer.id === this.pointerId) {
      this.pointerId = null;
      this.moveVector.x = 0;
      this.moveVector.y = 0;
      if (this.joystickThumb && this.joystickBase) {
        this.joystickThumb.x = this.joystickBase.x;
        this.joystickThumb.y = this.joystickBase.y;
      }
    }
  }

  updateJoystick(pointer) {
    if (!this.joystickBase || !this.joystickThumb) return;
    const dx = pointer.x - this.joystickBase.x;
    const dy = pointer.y - this.joystickBase.y;

    const maxDist = this.joystickBase.radius * 0.85;
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxDist);
    const angle = Math.atan2(dy, dx);

    const nx = Math.cos(angle) * dist;
    const ny = Math.sin(angle) * dist;

    this.joystickThumb.x = this.joystickBase.x + nx;
    this.joystickThumb.y = this.joystickBase.y + ny;

    // Normalizar para vector de movimiento (-1..1)
    this.moveVector.x = Math.cos(angle) * (dist / maxDist);
    this.moveVector.y = Math.sin(angle) * (dist / maxDist);
  }

  consumePauseAction() {
    const v = this.actionPause;
    this.actionPause = false;
    return v;
  }

  getMoveVector() {
    return { ...this.moveVector };
  }
}

