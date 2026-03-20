/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ShieldCheck, ShieldAlert, Trophy, Search, AlertCircle, 
  CheckCircle2, LogIn, LogOut, Mic, MicOff, Video, 
  Upload, Loader2, Play, Sparkles 
} from 'lucide-react';
import { auth, signIn, logOut, db, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, setDoc, getDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";

// --- Types ---
interface Scenario {
  id: number;
  text: string;
  isSafe: boolean;
}

// --- Constants ---
const SCENARIOS: Scenario[] = [
  { id: 1, text: "A typing game asks for your favorite color and animal.", isSafe: true },
  { id: 2, text: "A pop-up asks for your phone number to win a free iPad.", isSafe: false },
  { id: 3, text: "Your teacher tells you to go to the Amplify Reading website.", isSafe: true },
  { id: 4, text: "A player in Roblox you don't know asks what school you go to.", isSafe: false },
  { id: 5, text: "You watch a BrainPOP video about space that your teacher assigned.", isSafe: true },
  { id: 6, text: "A website asks for your home address to mail you a free toy.", isSafe: false },
];

// --- Error Boundary ---
function ErrorBoundary({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// --- Main App ---
export default function App() {
  return (
    <ErrorBoundary>
      <DetectiveGame />
    </ErrorBoundary>
  );
}

function DetectiveGame() {
  const [user, setUser] = useState<User | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [shake, setShake] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Live API State
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);

  // Veo State
  const [veoImage, setVeoImage] = useState<string | null>(null);
  const [veoVideoUrl, setVeoVideoUrl] = useState<string | null>(null);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [veoStatus, setVeoStatus] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      if (u) {
        syncUserProfile(u);
      }
    });
    return () => unsubscribe();
  }, []);

  const syncUserProfile = async (u: User) => {
    const userRef = doc(db, 'users', u.uid);
    try {
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid: u.uid,
          displayName: u.displayName,
          email: u.email,
          totalScore: 0,
          gamesPlayed: 0,
          lastPlayed: new Date().toISOString()
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${u.uid}`);
    }
  };

  const saveGameSession = async (finalScore: number) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'gameSessions'), {
        uid: user.uid,
        score: finalScore,
        timestamp: new Date().toISOString()
      });
      
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        await setDoc(userRef, {
          ...data,
          totalScore: (data.totalScore || 0) + finalScore,
          gamesPlayed: (data.gamesPlayed || 0) + 1,
          lastPlayed: new Date().toISOString()
        }, { merge: true });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'gameSessions');
    }
  };

  const handleChoice = (choice: boolean) => {
    const currentScenario = SCENARIOS[currentIndex];
    if (choice === currentScenario.isSafe) {
      setFeedback('correct');
      setScore(s => s + 1);
      
      setTimeout(() => {
        setFeedback(null);
        if (currentIndex < SCENARIOS.length - 1) {
          setCurrentIndex(i => i + 1);
        } else {
          setIsFinished(true);
          saveGameSession(score + 1);
        }
      }, 1000);
    } else {
      setFeedback('wrong');
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setFeedback(null);
      }, 500);
    }
  };

  // --- Gemini Live API Logic ---
  const startLiveAssistant = async () => {
    if (isLiveActive) {
      stopLiveAssistant();
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const session = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: "You are a friendly Digital Detective Assistant for 2nd graders. Help them understand internet safety in a fun, simple way. Keep responses short and encouraging.",
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsLiveActive(true);
            const source = audioContextRef.current!.createMediaStreamSource(streamRef.current!);
            const processor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            source.connect(processor);
            processor.connect(audioContextRef.current!.destination);
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
              }
              const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
              session.sendRealtimeInput({ audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' } });
            };
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
              const base64Audio = message.serverContent.modelTurn.parts[0].inlineData.data;
              const audioBlob = await fetch(`data:audio/pcm;rate=16000;base64,${base64Audio}`).then(r => r.blob());
              const audioUrl = URL.createObjectURL(audioBlob);
              const audio = new Audio(audioUrl);
              audio.play();
            }
            if (message.serverContent?.modelTurn?.parts[0]?.text) {
              setLiveTranscript(prev => prev + " " + message.serverContent?.modelTurn?.parts[0]?.text);
            }
          },
          onclose: () => stopLiveAssistant(),
          onerror: (e) => console.error("Live API Error:", e),
        }
      });
      sessionRef.current = session;
    } catch (err) {
      console.error("Failed to start Live Assistant:", err);
    }
  };

  const stopLiveAssistant = () => {
    setIsLiveActive(false);
    sessionRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioContextRef.current?.close();
  };

  // --- Veo Video Generation Logic ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setVeoImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const generateVeoVideo = async () => {
    if (!veoImage) return;
    
    // Check for API key as per guidelines
    if (!(await (window as any).aistudio.hasSelectedApiKey())) {
      await (window as any).aistudio.openSelectKey();
      return;
    }

    setIsGeneratingVideo(true);
    setVeoStatus("Starting video generation...");
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const base64Data = veoImage.split(',')[1];
      
      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: 'A master detective celebrating with a trophy, cinematic lighting, 4k',
        image: {
          imageBytes: base64Data,
          mimeType: 'image/png',
        },
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });

      while (!operation.done) {
        setVeoStatus("Detective is working hard on your video... (this takes a minute)");
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({ operation });
      }

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (downloadLink) {
        const response = await fetch(downloadLink, {
          method: 'GET',
          headers: { 'x-goog-api-key': process.env.API_KEY! },
        });
        const blob = await response.blob();
        setVeoVideoUrl(URL.createObjectURL(blob));
      }
    } catch (err) {
      console.error("Veo Error:", err);
      setVeoStatus("Oops! Video failed. Try again.");
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-blue-50">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-blue-50 text-center">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-white p-12 rounded-[3rem] border-8 border-blue-400 shadow-2xl max-w-md w-full"
        >
          <div className="text-8xl mb-6">🕵️‍♂️</div>
          <h1 className="text-4xl font-black text-blue-800 mb-4">Digital Detective</h1>
          <p className="text-xl text-gray-600 mb-8 font-bold">Sign in to start your training!</p>
          <button
            onClick={signIn}
            className="flex items-center justify-center gap-3 w-full bg-blue-500 hover:bg-blue-600 text-white text-2xl font-bold py-4 rounded-full shadow-lg transition-all transform hover:scale-105 active:scale-95"
          >
            <LogIn /> Google Sign In
          </button>
        </motion.div>
      </div>
    );
  }

  if (isFinished) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-yellow-50 text-center overflow-y-auto">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="bg-white p-8 md:p-12 rounded-[3rem] border-8 border-yellow-400 shadow-2xl max-w-2xl w-full my-8"
        >
          <div className="text-8xl mb-6">🏆</div>
          <h1 className="text-5xl font-black text-yellow-600 mb-4 tracking-tight">CASE CLOSED!</h1>
          <p className="text-2xl font-bold text-gray-700 mb-4">Master Detective: {user.displayName}</p>
          <div className="text-3xl font-bold text-blue-600 mb-8">Score: {score} / {SCENARIOS.length}</div>
          
          {/* Veo Section */}
          <div className="bg-blue-50 p-6 rounded-3xl border-4 border-blue-200 mb-8">
            <h3 className="text-xl font-bold text-blue-800 mb-4 flex items-center justify-center gap-2">
              <Sparkles className="text-yellow-500" /> Make a Victory Video!
            </h3>
            {!veoVideoUrl ? (
              <div className="flex flex-col items-center gap-4">
                <label className="cursor-pointer bg-white border-2 border-dashed border-blue-400 p-4 rounded-xl hover:bg-blue-100 transition-colors w-full">
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="text-blue-500" />
                    <span className="font-bold text-blue-600">{veoImage ? "Image Selected!" : "Upload a Photo"}</span>
                  </div>
                </label>
                {veoImage && (
                  <button
                    onClick={generateVeoVideo}
                    disabled={isGeneratingVideo}
                    className="bg-purple-500 hover:bg-purple-600 text-white font-bold py-3 px-8 rounded-full shadow-md disabled:opacity-50 flex items-center gap-2"
                  >
                    {isGeneratingVideo ? <Loader2 className="animate-spin" /> : <Video />}
                    {isGeneratingVideo ? "Generating..." : "Animate Me!"}
                  </button>
                )}
                {veoStatus && <p className="text-sm font-bold text-blue-500 italic">{veoStatus}</p>}
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden shadow-lg border-4 border-white">
                <video src={veoVideoUrl} controls autoPlay loop className="w-full" />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <button
              onClick={() => window.location.reload()}
              className="bg-blue-500 hover:bg-blue-600 text-white text-2xl font-bold py-4 px-12 rounded-full shadow-lg transition-all transform hover:scale-105 active:scale-95"
            >
              Play Again! 🔄
            </button>
            <button onClick={logOut} className="text-gray-400 font-bold hover:text-red-500 flex items-center justify-center gap-2">
              <LogOut size={18} /> Sign Out
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center p-4 md:p-8 select-none relative">
      {/* Header */}
      <header className="w-full max-w-4xl flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
          <div className="bg-yellow-400 p-3 rounded-2xl shadow-md">
            <Search className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl md:text-4xl font-black text-blue-800 tracking-tight">
            Digital Detective
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:block bg-white px-6 py-2 rounded-full border-4 border-blue-200 shadow-sm">
            <span className="text-xl font-bold text-blue-600">Case {currentIndex + 1} of {SCENARIOS.length}</span>
          </div>
          <button onClick={logOut} className="bg-red-100 p-3 rounded-2xl text-red-500 hover:bg-red-200 shadow-sm">
            <LogOut />
          </button>
        </div>
      </header>

      {/* Main Game Area */}
      <main className="flex-1 w-full max-w-2xl flex flex-col items-center justify-center gap-8">
        
        {/* Case File Card */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ x: 300, opacity: 0 }}
            animate={{ 
              x: shake ? [0, -20, 20, -20, 20, 0] : 0,
              opacity: 1,
              backgroundColor: feedback === 'wrong' ? '#fee2e2' : '#ffffff',
              borderColor: feedback === 'wrong' ? '#ef4444' : '#facc15'
            }}
            exit={{ x: -300, opacity: 0 }}
            className="case-card w-full min-h-[250px] relative"
          >
            <h2 className="text-2xl md:text-3xl font-bold text-gray-800 leading-relaxed px-4">
              "{SCENARIOS[currentIndex].text}"
            </h2>

            {feedback === 'wrong' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 text-red-600 font-bold text-xl flex items-center gap-2">
                <AlertCircle /> Try again!
              </motion.div>
            )}

            {feedback === 'correct' && (
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1.2 }} className="mt-4 text-green-600 font-bold text-xl flex items-center gap-2">
                <CheckCircle2 /> Great Job!
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Folders */}
        <div className="grid grid-cols-2 gap-6 w-full">
          <button
            onClick={() => handleChoice(true)}
            className="folder-btn bg-green-100 border-green-500 text-green-700 hover:bg-green-200"
          >
            <div className="text-6xl mb-2">✅</div>
            <span>Safe to Click</span>
          </button>

          <button
            onClick={() => handleChoice(false)}
            className="folder-btn bg-red-100 border-red-500 text-red-700 hover:bg-red-200"
          >
            <div className="text-6xl mb-2">🛑</div>
            <span>Stop & Tell</span>
          </button>
        </div>
      </main>

      {/* Assistant Toggle */}
      <div className="fixed bottom-8 right-8 flex flex-col items-end gap-4">
        {isLiveActive && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white p-4 rounded-2xl shadow-xl border-2 border-blue-400 max-w-xs text-sm font-bold text-blue-800"
          >
            Assistant: "I'm listening! Ask me anything about internet safety."
          </motion.div>
        )}
        <button
          onClick={startLiveAssistant}
          className={`p-6 rounded-full shadow-2xl transition-all transform hover:scale-110 active:scale-95 ${
            isLiveActive ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-500 text-white'
          }`}
        >
          {isLiveActive ? <MicOff size={32} /> : <Mic size={32} />}
        </button>
      </div>

      {/* Footer Score */}
      <footer className="mt-8 w-full max-w-4xl flex justify-center">
        <div className="flex gap-2">
          {SCENARIOS.map((_, i) => (
            <div 
              key={i}
              className={`w-4 h-4 rounded-full border-2 ${
                i < currentIndex ? 'bg-green-500 border-green-600' : 
                i === currentIndex ? 'bg-yellow-400 border-yellow-500 animate-pulse' : 
                'bg-gray-200 border-gray-300'
              }`}
            />
          ))}
        </div>
      </footer>
    </div>
  );
}
