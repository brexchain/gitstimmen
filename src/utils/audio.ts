/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { TuningString } from '../types';

export const STANDARD_TUNING_STRINGS: TuningString[] = [
  { id: '6', note: 'E', octave: 2, frequency: 82.41, label: '6th' },
  { id: '5', note: 'A', octave: 2, frequency: 110.00, label: '5th' },
  { id: '4', note: 'D', octave: 3, frequency: 146.83, label: '4th' },
  { id: '3', note: 'G', octave: 3, frequency: 196.00, label: '3rd' },
  { id: '2', note: 'B', octave: 3, frequency: 246.94, label: '2nd' },
  { id: '1', note: 'E', octave: 4, frequency: 329.63, label: '1st' }
];

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Find pitch data from precise frequency
 */
export function getNoteFromFrequency(frequency: number) {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
  const midiNum = Math.round(noteNum) + 69;
  const noteIndex = ((midiNum % 12) + 12) % 12;
  const octave = Math.floor(midiNum / 12) - 1;
  const expectedFreq = 440 * Math.pow(2, (midiNum - 69) / 12);
  const cents = 1200 * Math.log2(frequency / expectedFreq);
  return {
    note: NOTE_NAMES[noteIndex],
    midi: midiNum,
    octave,
    expectedFrequency: expectedFreq,
    cents
  };
}

/**
 * Pitch detection using YIN algorithm
 */
export function detectPitchYIN(buffer: Float32Array, sampleRate: number, threshold = 0.15): number {
  const SIZE = buffer.length;
  const halfSize = Math.floor(SIZE / 2);
  const yinBuffer = new Float32Array(halfSize);

  // Step 1: Difference Function
  for (let tau = 0; tau < halfSize; tau++) {
    let sum = 0;
    for (let i = 0; i < halfSize; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    yinBuffer[tau] = sum;
  }

  // Step 2: Cumulative Mean Normalized Difference Function
  yinBuffer[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfSize; tau++) {
    runningSum += yinBuffer[tau];
    yinBuffer[tau] *= tau / (runningSum || 1);
  }

  // Step 3: Absolute Thresholding
  let tau = -1;
  for (let i = 2; i < halfSize; i++) {
    if (yinBuffer[i] < threshold) {
      while (i + 1 < halfSize && yinBuffer[i + 1] < yinBuffer[i]) {
        i++;
      }
      tau = i;
      break;
    }
  }

  // If no low valley found, take global minimum
  if (tau === -1) {
    let minVal = 1;
    for (let i = 2; i < halfSize; i++) {
      if (yinBuffer[i] < minVal) {
        minVal = yinBuffer[i];
        tau = i;
      }
    }
    // If global minimum is still too noisy, fail
    if (minVal > 0.35 || tau === -1) {
      return -1;
    }
  }

  // Step 4: Parabolic Interpolation for higher accuracy
  const x0 = tau > 0 ? tau - 1 : tau;
  const x2 = tau + 1 < halfSize ? tau + 1 : tau;
  let betterTau = tau;

  if (x0 === tau) {
    betterTau = yinBuffer[tau] <= yinBuffer[x2] ? tau : x2;
  } else if (x2 === tau) {
    betterTau = yinBuffer[tau] <= yinBuffer[x0] ? tau : x0;
  } else {
    const s0 = yinBuffer[x0];
    const s1 = yinBuffer[tau];
    const s2 = yinBuffer[x2];
    const denominator = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denominator) > 1e-5) {
      betterTau = tau + (s2 - s0) / denominator;
    }
  }

  return sampleRate / betterTau;
}

/**
 * Play standard guitar string reference target frequency
 */
export function playTone(audioContext: AudioContext, frequency: number, duration = 1.2) {
  const osc = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  osc.connect(gainNode);
  gainNode.connect(audioContext.destination);

  // Beautiful combination sine and triangle wave for a warm guitar string feel
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, audioContext.currentTime);

  gainNode.gain.setValueAtTime(0, audioContext.currentTime);
  // Attack
  gainNode.gain.linearRampToValueAtTime(0.2, audioContext.currentTime + 0.05);
  // Decay / Release
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);

  osc.start(audioContext.currentTime);
  osc.stop(audioContext.currentTime + duration);

  return { osc, gainNode };
}
