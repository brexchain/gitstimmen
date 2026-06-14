/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TuningString {
  id: string;
  note: string;
  octave: number;
  frequency: number;
  label: string;
}

export interface PitchDetectionResult {
  frequency: number;
  note: string;
  cents: number;
  targetFreq: number;
  midi: number;
}
