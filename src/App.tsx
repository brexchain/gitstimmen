/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  Settings, 
  Sparkles, 
  Info, 
  HelpCircle,
  Hash,
  Activity,
  CheckCircle2,
  RefreshCw,
  Trophy,
  ArrowRight
} from 'lucide-react';
import { STANDARD_TUNING_STRINGS, getNoteFromFrequency, detectPitchYIN, playTone } from './utils/audio';
import { TuningString } from './types';

// Additional popular instrument presets for high premium utility
const INSTRUMENT_PRESETS = [
  { name: 'Klampfe (Standard E-A-D-G-B-E)', strings: STANDARD_TUNING_STRINGS },
  { name: 'Wumm-Bass (Viersaiter)', strings: [
    { id: 'b4', note: 'E', octave: 1, frequency: 41.20, label: 'E-Bass' },
    { id: 'b3', note: 'A', octave: 1, frequency: 55.00, label: 'A-Bass' },
    { id: 'b2', note: 'D', octave: 2, frequency: 73.42, label: 'D-Bass' },
    { id: 'b1', note: 'G', octave: 2, frequency: 98.00, label: 'G-Bass' }
  ]},
  { name: 'Hula-Ukulele (Standard)', strings: [
    { id: 'u4', note: 'G', octave: 4, frequency: 392.00, label: 'G-Uke' },
    { id: 'u3', note: 'C', octave: 4, frequency: 261.63, label: 'C-Uke' },
    { id: 'u2', note: 'E', octave: 4, frequency: 329.63, label: 'E-Uke' },
    { id: 'u1', note: 'A', octave: 4, frequency: 440.00, label: 'A-Uke' }
  ]}
];

export default function App() {
  const [activePresetIndex, setActivePresetIndex] = useState(0);
  const currentPreset = INSTRUMENT_PRESETS[activePresetIndex];

  // Tuner state
  const [isListening, setIsListening] = useState(false);
  const [frequency, setFrequency] = useState<number | null>(null);
  const [noteName, setNoteName] = useState<string>('--');
  const [octave, setOctave] = useState<number | null>(null);
  const [centsDeviation, setCentsDeviation] = useState<number>(0);
  const [smoothedCents, setSmoothedCents] = useState<number>(0);
  const [inputLevel, setInputLevel] = useState<number>(0); // 0 to 100 for input visualization
  const [selectedString, setSelectedString] = useState<TuningString | null>(null); // Target locked string

  // Audio nodes & references
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const noiseCountRef = useRef<number>(0);

  // Stats / Gamification State
  const [successCount, setSuccessCount] = useState<number>(0);
  const [showPerfectAnimation, setShowPerfectAnimation] = useState(false);
  const [showPermissionsHelp, setShowPermissionsHelp] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Keep a reference to the latest smoothed cents to avoid state closures in requestAnimationFrame
  const centsRef = useRef<number>(0);
  centsRef.current = smoothedCents;

  const isPerfect = frequency !== null && Math.abs(centsDeviation) <= 2.5;

  // Track perfection to trigger rewards/stats or celebration
  useEffect(() => {
    if (isPerfect && isListening) {
      setShowPerfectAnimation(true);
      const timer = setTimeout(() => {
        setShowPerfectAnimation(false);
      }, 1500);

      // Increment stats for a nice feeling of progress
      setSuccessCount(prev => prev + 1);

      return () => clearTimeout(timer);
    }
  }, [isPerfect, isListening]);

  // Clean up audio references on unmount
  useEffect(() => {
    return () => {
      stopTuner();
    };
  }, []);

  const requestMicrophone = async () => {
    setErrorText(null);
    try {
      // Lazy initialize AudioContext
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        throw new Error('Dein internetter Webbrowser schnallt die Web Audio API leider nicht.');
      }

      let stream: MediaStream;
      try {
        // Try requesting with optimal professional audio processing options disabled for raw pitch accuracy
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          }
        });
      } catch (innerErr) {
        console.warn('Advanced audio constraints not supported or failed. Attempting basic fallback stream.', innerErr);
        // Fallback to basic audio stream request
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      streamRef.current = stream;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048; // Large FFT size for accurate low-frequency resolution
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      setIsListening(true);
      setShowPermissionsHelp(false);

      // Start detection recursion
      processAudio();

    } catch (err: any) {
      console.error('Microphone access failed:', err);
      setIsListening(false);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.message?.includes('denied')) {
        setShowPermissionsHelp(true);
        setErrorText('Mikrofon-Zugriff verweigert! Falls du im eingebetteten UI festsitzt, klick bitte oben rechts auf "Open in New Tab" (In neuem Tab öffnen) um die Browsergrenzen zu umgehen!');
      } else {
        setErrorText(err.message || 'Huckepack-Fehler beim Lauschen. Steckt das Mikro überhaupt drin?');
      }
    }
  };

  const stopTuner = () => {
    setIsListening(false);
    setFrequency(null);
    setNoteName('--');
    setOctave(null);
    setCentsDeviation(0);
    setSmoothedCents(0);
    setInputLevel(0);

    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      if (audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  };

  const toggleTuner = () => {
    if (isListening) {
      stopTuner();
    } else {
      requestMicrophone();
    }
  };

  /**
   * Continuous loop fetching dynamic audio frequencies
   */
  const processAudio = () => {
    if (!analyserRef.current || !audioContextRef.current) return;

    const analyser = analyserRef.current;
    const sampleRate = audioContextRef.current.sampleRate;
    const bufferLength = analyser.fftSize;
    const dataArray = new Float32Array(bufferLength);

    analyser.getFloatTimeDomainData(dataArray);

    // Calculate signal power (RMS volume level)
    let sumSquares = 0;
    for (let i = 0; i < bufferLength; i++) {
      sumSquares += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sumSquares / bufferLength);
    const volumePercentage = Math.min(100, Math.round(rms * 450));
    setInputLevel(volumePercentage);

    // Threshold gate to ignore quiet noise
    if (rms < 0.007) {
      // Smoothly drift needle towards center if user stopped picking the string
      setSmoothedCents(prev => prev * 0.88);
      setFrequency(null);
      noiseCountRef.current = 0;
    } else {
      const detectedFreq = detectPitchYIN(dataArray, sampleRate);

      // Quality filter - restrict boundaries to standard string harmonic frequencies (50Hz - 1200Hz)
      if (detectedFreq !== -1 && detectedFreq > 50 && detectedFreq < 1200) {
        setFrequency(Math.round(detectedFreq * 100) / 100);

        // Lock onto note values
        let currentTargetFreq = detectedFreq;
        let noteSymbol = '';
        let centsDev = 0;
        let activeOctave: number | null = null;

        if (selectedString) {
          // Locked view: calculate deviation *only* relative to the locked target string
          currentTargetFreq = selectedString.frequency;
          noteSymbol = selectedString.note;
          activeOctave = selectedString.octave;
          centsDev = 1200 * Math.log2(detectedFreq / currentTargetFreq);
        } else {
          // Auto chromatic lookup: find closest octave note on tempered chromatic scale
          const noteData = getNoteFromFrequency(detectedFreq);
          noteSymbol = noteData.note;
          centsDev = noteData.cents;
          activeOctave = noteData.octave;
        }

        // Clamp cents deviation to [-50, +50] for rendering bounds
        const targetCents = Math.max(-50, Math.min(50, centsDev));
        setCentsDeviation(Math.round(targetCents * 10) / 10);
        setNoteName(noteSymbol);
        setOctave(activeOctave);

        // Responsive damping filter: fast to react, but avoids extreme high frequency shake/shiver
        setSmoothedCents(prev => {
          const alpha = 0.23;
          return prev * (1 - alpha) + targetCents * alpha;
        });

        noiseCountRef.current = 0;
      } else {
        // Increment noise buffer counter to gracefully smooth momentary dropouts
        noiseCountRef.current += 1;
        if (noiseCountRef.current > 12) {
          setSmoothedCents(prev => prev * 0.92);
          setFrequency(null);
        }
      }
    }

    // Recur
    animationFrameId.current = requestAnimationFrame(processAudio);
  };

  /**
   * Reference Audio synth player helper
   */
  const handlePlayReference = (item: TuningString) => {
    try {
      // Set target lock to this string
      setSelectedString(prev => prev?.id === item.id ? null : item);

      // Play pure sine wave reference sound feedback
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      playTone(ctx, item.frequency, 1.4);
    } catch (e) {
      console.warn("Could not generate audio context reference tone", e);
    }
  };

  // Convert smoothedcents [-50, 50] to needle degrees [-60, 60]
  const needleRotation = (smoothedCents / 50) * 60;

  return (
    <div id="tuner-root" className="min-h-screen safe-top safe-bottom flex flex-col justify-between p-4 max-w-md mx-auto relative select-none">
      
      {/* Decorative Cosmic background gradient highlights */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-slate-700/10 rounded-full blur-3xl pointer-events-none" />
      <div className={`absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full blur-3xl pointer-events-none transition-all duration-1000 ${
        isListening 
          ? isPerfect 
            ? 'bg-emerald-500/15 scale-110' 
            : Math.abs(centsDeviation) < 15 
              ? 'bg-amber-500/10' 
              : 'bg-rose-500/10'
          : 'bg-cyan-500/5'
      }`} />

      {/* Top Bar navigation */}
      <header className="flex flex-col space-y-1 z-10 py-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="relative flex items-center justify-center">
              <span className={`p-1.5 rounded-lg bg-slate-900 border border-slate-800 ${isListening ? 'text-emerald-400' : 'text-slate-500'}`}>
                <Activity className="w-5 h-5 animate-pulse" />
              </span>
              {isListening && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
              )}
            </div>
            <div>
              <h1 className="text-sm font-extrabold tracking-wider text-slate-100">STIMM-O-MAT</h1>
              <p className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
                {currentPreset.name}
              </p>
            </div>
          </div>

          {/* Preset Selector Pill */}
          <button 
            onClick={() => {
              setSelectedString(null);
              setActivePresetIndex(prev => (prev + 1) % INSTRUMENT_PRESETS.length);
            }}
            className="flex items-center space-x-1 bg-slate-900/95 hover:bg-slate-800 border border-slate-800/80 px-3 py-1.5 rounded-full text-[11px] font-semibold text-slate-300 shadow-sm active:scale-95 transition-all"
          >
            <RefreshCw className="w-3 h-3 text-slate-450 animate-spin-hover" />
            <span>Anderes Holz 🎸</span>
          </button>
        </div>

        {/* Offline Badge */}
        <div className="flex items-center justify-end">
          <span className="text-[9px] font-mono font-bold bg-slate-900/70 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 shadow-sm">
            ✓ 100% Offline-bereit! (Klappt auch im Schwarzwald 🌲)
          </span>
        </div>
      </header>

      {/* Core display: Needle & Pitch movements */}
      <main className="my-auto py-3 flex flex-col items-center justify-center z-10">

        {/* Physical Arc Gauge Container */}
        <div className="relative w-full max-w-[290px] h-[190px] mx-auto mt-1 flex flex-col items-center justify-end overflow-hidden select-none">
          
          {/* Subtle curved arc template representing standard guitar tuner dial */}
          <svg className="absolute inset-0 w-full h-full text-slate-700" viewBox="0 0 200 120" fill="none">
            {/* Background track path */}
            <path 
              d="M 20 110 A 84 84 0 0 1 180 110" 
              stroke="currentColor" 
              strokeWidth="2.5" 
              strokeLinecap="round"
              strokeDasharray="3 4"
              className="opacity-30"
            />
            {/* In-Tune Sweet Zone (center) */}
            <path 
              d="M 90 27.5 A 84 84 0 0 1 110 27.5" 
              stroke="#10b981" 
              strokeWidth="5" 
              strokeLinecap="round"
              className="opacity-80 shadow-sm"
            />
            {/* Flat indicators (Left) */}
            <line x1="20" y1="110" x2="25" y2="105" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" className="opacity-60" />
            <line x1="50" y1="67" x2="56" y2="65" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" className="opacity-60" />
            
            {/* Centered zero mark */}
            <line x1="100" y1="21" x2="100" y2="28" stroke="#10b981" strokeWidth="3" className="opacity-95" />
            
            {/* Sharp indicators (Right) */}
            <line x1="150" y1="67" x2="144" y2="65" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" className="opacity-60" />
            <line x1="180" y1="110" x2="175" y2="105" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" className="opacity-60" />

            {/* Custom subtle tick marks across scale */}
            {Array.from({ length: 9 }).map((_, i) => {
              const cents = -40 + i * 10;
              if (cents === 0) return null;
              const angle = (cents / 50) * 60; // deg
              const rad = ((90 - angle) * Math.PI) / 180;
              const x1 = 100 + 82 * Math.cos(rad);
              const y1 = 110 - 82 * Math.sin(rad);
              const x2 = 100 + 87 * Math.cos(rad);
              const y2 = 110 - 87 * Math.sin(rad);
              const color = Math.abs(cents) < 15 ? '#f59e0b' : '#94a3b8';
              return (
                <line 
                  key={i} 
                  x1={x1} 
                  y1={y1} 
                  x2={x2} 
                  y2={y2} 
                  stroke={color} 
                  strokeWidth="1.5" 
                  className="opacity-45" 
                />
              );
            })}
          </svg>

          {/* Light and Bright dynamic dial face behind the note letter */}
          <div className={`absolute bottom-0 w-36 h-36 rounded-full -translate-y-5 flex items-center justify-center transition-all duration-300 ${
            isListening 
              ? isPerfect 
                ? 'bg-[#ffffff] text-slate-900 border-4 border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.5)] scale-105' 
                : Math.abs(centsDeviation) < 15
                  ? 'bg-[#f8fafc] text-slate-900 border-4 border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.25)] scale-100'
                  : 'bg-[#f8fafc] text-slate-900 border-4 border-rose-500 shadow-[0_0_20px_rgba(239,68,68,0.25)] scale-100'
              : 'bg-[#f1f5f9] text-slate-950 border-4 border-slate-300 shadow-md scale-100'
          }`}>
            <div className="text-center">
              {/* Cents numeric display */}
              <div className="h-4">
                {isListening && frequency ? (
                  <span className={`text-xs font-mono font-bold tracking-wide ${
                    isPerfect 
                      ? 'text-emerald-600' 
                      : centsDeviation < 0 
                        ? 'text-amber-600' 
                        : 'text-rose-600'
                  }`}>
                    {centsDeviation > 0 ? `+${centsDeviation}` : centsDeviation}¢
                  </span>
                ) : (
                  <span className="text-[9px] text-slate-500 font-bold tracking-wider font-mono uppercase">
                    {selectedString ? 'KAPERT!' : 'AUTOMATIK'}
                  </span>
                )}
              </div>

              {/* Big central Note display with high light-contrast */}
              <div className="relative font-sans font-black text-[70px] leading-none tracking-tighter text-slate-900 select-none flex items-baseline justify-center">
                <span>{noteName}</span>
                {octave !== null && isListening && frequency && (
                  <span className="text-sm font-mono font-bold text-slate-600 ml-0.5 absolute -right-3.5 bottom-2 bg-slate-200/80 px-1 rounded">
                    {octave}
                  </span>
                )}
              </div>

              {/* Precise Frequency readout or hints */}
              <div className="text-xs font-mono text-slate-600 mt-1 flex items-center justify-center space-x-1">
                {isListening && frequency ? (
                  <>
                    <span className="text-slate-950 font-extrabold">{frequency.toFixed(1)}</span>
                    <span className="text-slate-500 font-semibold">Hz</span>
                  </>
                ) : (
                  <span className="text-[10px] font-bold tracking-tight font-mono text-slate-500">
                    {isListening ? 'SAITE ZUPFEN...' : 'PAUSIERT'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Smooth physical analog Needle representation - high-contrast deep color */}
          <div 
            className="absolute bottom-0 left-1/2 w-4 h-full origin-bottom -translate-x-1/2 pointer-events-none transition-transform duration-75 ease-out"
            style={{ 
              transform: `translateX(-50%) rotate(${needleRotation}deg)`,
              height: '84%'
            }}
          >
            {/* The line and pointer block */}
            <div className="relative w-full h-full">
              {/* Tapered Needle Pin - Sleek Charcoal-Black line for pristine clarity on light circle */}
              <div className={`w-[3px] mx-auto h-[90%] rounded-t-full transition-colors duration-300 ${
                isListening 
                  ? isPerfect 
                    ? 'bg-emerald-600 shadow-[0_0_12px_#059669]' 
                    : Math.abs(centsDeviation) < 15
                      ? 'bg-amber-600 shadow-[0_0_8px_#d97706]'
                      : 'bg-rose-600'
                  : 'bg-slate-800'
              }`} />
              
              {/* Arrow or dot head styling */}
              <div className={`w-2.5 h-2.5 -mt-1 py-0.5 mx-auto rounded-full transition-colors ${
                isListening 
                  ? isPerfect 
                    ? 'bg-emerald-600' 
                    : Math.abs(centsDeviation) < 15
                      ? 'bg-amber-600'
                      : 'bg-rose-600'
                  : 'bg-slate-800'
              }`} />
            </div>
          </div>

          {/* Physical Needle pivot core cap */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-3 w-8 h-8 rounded-full bg-[#f8fafc] border-4 border-slate-800 shadow-md flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-slate-950" />
          </div>

        </div>

        {/* Cents Scale Visual bar under the dial */}
        <div className="w-full px-8 mt-2 select-none">
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 px-1 mb-1">
            <span className="font-bold text-amber-500">SCHLAFF (-50¢)</span>
            <span className={`${isListening && isPerfect ? 'text-emerald-400 font-extrabold' : 'text-slate-300 font-semibold'}`}>BOMBENFEST!</span>
            <span className="font-bold text-rose-500 font-medium">ZU STRAMM (+50¢)</span>
          </div>

          {/* Visual gradient slider strip */}
          <div className="h-2.5 rounded-full bg-[#181a24] border border-slate-800/80 relative overflow-hidden flex items-center justify-center">
            {/* Linear scale zero mark indicator */}
            <div className="absolute top-0 bottom-0 w-0.5 bg-slate-600 left-1/2 -translate-x-1/2" />
            
            {/* Dynamic visual slider filling left/right based on deviation */}
            {isListening && frequency && (
              <motion.div 
                className={`absolute top-0 bottom-0 rounded-full ${
                  isPerfect 
                    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]' 
                    : centsDeviation < 0 
                      ? 'bg-gradient-to-r from-transparent to-amber-400' 
                      : 'bg-gradient-to-l from-transparent to-rose-400'
                }`}
                style={{
                  left: centsDeviation < 0 ? `${50 + centsDeviation}%` : '50%',
                  right: centsDeviation < 0 ? '50%' : `${50 - centsDeviation}%`
                }}
                layoutId="deviation-bar"
              />
            )}
          </div>
        </div>

        {/* Dynamic Perfection Congratulations Banner */}
        <div className="h-10 mt-2 flex items-center justify-center">
          <AnimatePresence mode="wait">
            {isListening && isPerfect && (
              <motion.div 
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="flex items-center space-x-2 bg-emerald-950/90 border border-emerald-500/30 px-3.5 py-1.5 rounded-full text-xs font-semibold text-emerald-300 shadow-[0_4px_12px_rgba(16,185,129,0.15)] max-w-xs"
              >
                <Sparkles className="w-3.5 h-3.5 text-emerald-300 animate-pulse" />
                <span>Hundertprozentig knorke! Lass die Saite ab!</span>
              </motion.div>
            )}

            {isListening && !isPerfect && frequency !== null && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={`text-xs font-bold uppercase tracking-widest ${
                  centsDeviation < 0 ? 'text-amber-400 animate-pulse' : 'text-rose-400 animate-pulse'
                }`}
              >
                {centsDeviation < 0 ? 'HÖHER DREHEN! ↗' : 'RÜCKWÄRTS DREHEN! ↘'}
              </motion.div>
            )}

            {!isListening && (
              <div className="text-[11px] font-bold text-slate-400 select-none animate-pulse text-center tracking-wide">
                STIMM-KAMPF STARTEN & KLAMPFEN-SAITE ANREISSEN!
              </div>
            )}
          </AnimatePresence>
        </div>

      </main>

      {/* Mic Audio signal strength slider gauge */}
      <footer className="w-full space-y-4 z-10">
        
        {/* Pitch detection state / helper section */}
        <div className="bg-[#12141d]/90 border border-slate-800/80 rounded-2xl p-4 shadow-inner space-y-3.5">
          
          {/* Signal power feedback row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {inputLevel > 15 ? (
                <Volume2 className="w-4 h-4 text-emerald-400 animate-pulse" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-500" />
              )}
              <span className="text-[11px] font-mono font-extrabold uppercase tracking-wide text-slate-400">
                Krachtvoll-Lauscher (Mikro-Pegel)
              </span>
            </div>
            <span className="text-[10px] font-mono text-slate-400 font-bold">
              {isListening ? `${inputLevel}%` : 'RUHE IM KARTON'}
            </span>
          </div>

          <div className="relative w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
            <div 
              className={`absolute top-0 left-0 bottom-0 rounded-full transition-all duration-100 ${
                inputLevel > 60 
                  ? 'bg-rose-500' 
                  : inputLevel > 15 
                    ? 'bg-emerald-400' 
                    : 'bg-slate-700'
              }`}
              style={{ width: `${isListening ? inputLevel : 0}%` }}
            />
          </div>

          {/* Peg Board string selector layout (6 Standard strings default or preset) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wide text-slate-400">
                Referenz-Klimperer zum Festzurren:
              </span>
              {selectedString && (
                <button 
                  onClick={() => setSelectedString(null)}
                  className="text-[10px] font-mono font-bold text-amber-400 hover:underline active:scale-95 transition-all bg-amber-950/20 px-1.5 py-0.5 rounded"
                >
                  Suche befreien [X]
                </button>
              )}
            </div>

            <div className="grid grid-cols-6 gap-2">
              {currentPreset.strings.map((item) => {
                const isSelected = selectedString?.id === item.id;
                const isMatch = noteName === item.note && frequency !== null;

                return (
                  <button
                    key={item.id}
                    onClick={() => handlePlayReference(item)}
                    id={`string-button-${item.note}`}
                    className={`relative py-2 px-1 rounded-xl flex flex-col items-center justify-center transition-all border ${
                      isSelected 
                        ? 'bg-amber-500/20 text-amber-300 border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.2)] scale-102' 
                        : isMatch && isListening
                          ? isPerfect 
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/80 scale-102'
                            : 'bg-slate-800/80 text-slate-100 border-slate-700'
                          : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {/* Peg Label (e.g. 6th, E) */}
                    <span className="text-[9px] font-mono uppercase text-slate-500 tracking-wider font-bold block mb-0.5">
                      {item.label}
                    </span>
                    <span className="text-sm font-extrabold tracking-tight">
                      {item.note}
                    </span>
                    <span className="text-[9px] font-mono text-slate-500 mt-0.5">
                      {Math.round(item.frequency)} Hz
                    </span>

                    {/* Small action trigger indicator (dot) */}
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 block ${
                      isSelected 
                        ? 'bg-amber-400 animate-ping' 
                        : isMatch && isListening && isPerfect
                          ? 'bg-emerald-400'
                          : 'bg-transparent'
                    }`} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reference guidelines summary banner */}
          <div className="flex items-start space-x-2 text-[11px] text-slate-400 leading-relaxed bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/50">
            <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
            <div>
              <p>
                <strong className="text-slate-300">Klampfen-Tipp:</strong> Drücke oben eine Taste, um den echten Ton anzuhören. Dadurch wird auch diese <span className="text-amber-400 font-bold">Saite festgetackert</span>, damit der Klampfen-Lauscher nicht von Nebengeräuschen abgelenkt wird!
              </p>
            </div>
          </div>

        </div>

        {/* Primary Call to Action Start listening trigger */}
        <div className="flex flex-col space-y-2">
          
          <button
            onClick={toggleTuner}
            id="start-button"
            className={`w-full py-3.5 px-6 rounded-2xl font-black tracking-widest text-xs uppercase flex items-center justify-center space-x-2 shadow-lg active:scale-[0.98] transition-all cursor-pointer ${
              isListening 
                ? 'bg-rose-500/90 text-white hover:bg-rose-600 shadow-rose-950/20 border border-rose-400/25' 
                : 'bg-gradient-to-r from-slate-100 to-white text-slate-950 hover:from-white hover:to-white shadow-slate-950/40 border border-white/20'
            }`}
          >
            {isListening ? (
              <>
                <MicOff className="w-5 h-5 shrink-0" />
                <span>HORCHPOSTEN ABBREAKEN</span>
              </>
            ) : (
              <>
                <Mic className="w-5 h-5 shrink-0 animate-bounce" />
                <span>AKTIVES MIKROFORT ANWERFEN</span>
              </>
            )}
          </button>

          {/* Success metric indicator block */}
          {successCount > 0 && (
            <div className="text-[11px] font-mono text-slate-400 flex items-center justify-center space-x-1.5 py-1">
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span>Glatte Treffer in dieser Runde:</span>
              <strong className="text-emerald-400 bg-slate-900 px-2 py-0.5 rounded-md border border-slate-800">{successCount}</strong>
            </div>
          )}

        </div>

        {/* Beautiful helper message if microphone is blocked */}
        <AnimatePresence>
          {showPermissionsHelp && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              className="p-3.5 bg-rose-950/80 border border-rose-500/30 rounded-2xl flex flex-col space-y-2"
            >
              <div className="flex items-start space-x-2.5">
                <HelpCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
                <div className="text-[11px] text-rose-200 leading-relaxed">
                  <h4 className="font-extrabold uppercase tracking-wider mb-0.5">SABBELERLAUBNIS FEHLT!</h4>
                  <p>
                    Drücke oben links auf das kleine Schloss in deiner Browserleiste und gib das Mikrofon frei. Ansonsten kriegt unser Zaubermechanismus deine Klampfenwellen nicht zu fassen!
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {errorText && !showPermissionsHelp && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-xs text-center text-rose-400 font-mono"
            >
              {errorText}
            </motion.div>
          )}
        </AnimatePresence>
        
      </footer >

    </div>
  );
}
