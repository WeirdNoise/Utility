import React, { useState, useEffect, useRef } from 'react';
import { 
  FileAudio, 
  Mic, 
  MessageSquare, 
  Wand2, 
  Download, 
  X, 
  CheckCircle2, 
  AlertCircle,
  Settings2,
  Music,
  Sliders,
  Gauge,
  Activity,
  Trash2,
  Plus,
  FolderDown,
  Play,
  Bug,
  Terminal
} from 'lucide-react';
import { AppMode, AudioFormat, BatchFile, ConverterConfig, SampleRate, ProcessingStatus } from './types';
import { UploadZone } from './components/UploadZone';
import { Button } from './components/Button';
import { convertAudio } from './services/audioService';
import { transcribeAudio, generateSpeech } from './services/geminiService';
import JSZip from 'jszip';

export default function App() {
  const [mode, setMode] = useState<AppMode>(AppMode.CONVERTER);
  
  // Batch State
  const [files, setFiles] = useState<BatchFile[]>([]);
  
  // Converter Config State
  const [converterConfig, setConverterConfig] = useState<ConverterConfig>({
    format: AudioFormat.WAV,
    bitrate: 192,
    sampleRate: SampleRate.HZ_44100
  });

  const [isProcessing, setIsProcessing] = useState(false);
  
  // Transcriber state (Single file only for now, or last selected)
  const [transcription, setTranscription] = useState<string>("");
  
  // TTS State
  const [ttsText, setTtsText] = useState("");
  const [ttsVoice, setTtsVoice] = useState("Kore");
  const [ttsResultUrl, setTtsResultUrl] = useState<string | null>(null);

  // Global Error
  const [error, setError] = useState<string | null>(null);

  // --- DEBUG SYSTEM ---
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setDebugLogs(prev => [`[${time}] ${msg}`, ...prev]);
  };

  // --- WEB AUDIO API REFERENCES ---
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const AUDIO_PATH = '/sounds/MusiqueDuJeu.mp3';

  // Initialize Audio Context & Load File
  useEffect(() => {
    const initAudio = async () => {
      try {
        addLog(`INITIALISATION: Démarrage Web Audio API...`);
        // @ts-ignore
        const CtxClass = window.AudioContext || window.webkitAudioContext;
        const ctx = new CtxClass();
        audioContextRef.current = ctx;

        addLog(`FETCH: Téléchargement de ${AUDIO_PATH}...`);
        const response = await fetch(AUDIO_PATH);
        
        if (!response.ok) {
          throw new Error(`Erreur HTTP ${response.status} pour le fichier audio.`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        addLog(`DECODAGE: Décodage du fichier audio (${arrayBuffer.byteLength} bytes)...`);
        
        // Décodage des données audio
        try {
          const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
          audioBufferRef.current = decodedBuffer;
          addLog(`SUCCÈS: Audio chargé en mémoire ! Durée: ${decodedBuffer.duration.toFixed(2)}s`);
        } catch (decodeErr: any) {
          addLog(`ERREUR DECODAGE: Le fichier est peut-être corrompu ou format non supporté. ${decodeErr.message}`);
        }

      } catch (e: any) {
        addLog(`ERREUR INITIALISATION AUDIO: ${e.message}`);
      }
    };

    initAudio();

    return () => {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Fonction pour jouer le son à la fin via Web Audio API
  const notifyEnd = () => {
    if (!audioContextRef.current || !audioBufferRef.current) {
      addLog("ERREUR NOTIFY: AudioContext non prêt ou buffer vide.");
      return;
    }

    try {
      addLog("NOTIFY: Création de la source audio...");
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBufferRef.current;
      source.connect(audioContextRef.current.destination);
      source.start(0);
      addLog("NOTIFY: Commande de lecture envoyée.");
    } catch (e: any) {
      addLog(`ERREUR PLAY: ${e.message}`);
    }
  };

  // Cleanup URLs
  useEffect(() => {
    return () => {
      files.forEach(f => {
        if (f.url) URL.revokeObjectURL(f.url);
        if (f.outputUrl) URL.revokeObjectURL(f.outputUrl);
      });
      if (ttsResultUrl) URL.revokeObjectURL(ttsResultUrl);
    };
  }, [files, ttsResultUrl]);

  const handleFileSelect = (selectedFiles: File[]) => {
    const newFiles: BatchFile[] = selectedFiles.map(f => ({
      file: f,
      name: f.name,
      size: f.size,
      type: f.type,
      url: URL.createObjectURL(f),
      id: Math.random().toString(36).substring(7),
      status: ProcessingStatus.IDLE,
      progress: 0
    }));

    if (mode === AppMode.CONVERTER) {
      setFiles(prev => [...prev, ...newFiles]);
    } else {
      setFiles([newFiles[0]]);
      setTranscription("");
    }
    setError(null);
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const getExtension = (mime: string) => {
    switch (mime) {
      case AudioFormat.WAV: return 'wav';
      case AudioFormat.MP3: return 'mp3';
      case AudioFormat.WEBM: return 'webm';
      case AudioFormat.OGG: return 'ogg';
      case AudioFormat.AAC: return 'aac';
      case AudioFormat.FLAC: return 'flac';
      default: return 'bin';
    }
  };

  const processBatch = async () => {
    addLog("PROCESS: Démarrage du traitement...");

    // --- ASTUCE NAVIGATEUR (Autoplay Policy - Web Audio API) ---
    // On reprend le contexte audio au clic utilisateur s'il est suspendu
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        try {
            addLog("AUTOPLAY: Reprise du contexte audio (resume)...");
            await audioContextRef.current.resume();
            addLog(`AUTOPLAY: Contexte actif (State: ${audioContextRef.current.state})`);
        } catch (e: any) {
            addLog(`AUTOPLAY ECHEC: Impossible de reprendre le contexte. ${e.message}`);
        }
    }
    // -------------------------------------------

    setIsProcessing(true);
    setError(null);

    const filesToProcess = files.filter(f => f.status !== ProcessingStatus.DONE);
    
    for (const fileItem of filesToProcess) {
       setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, status: ProcessingStatus.PROCESSING, progress: 0 } : f));

       try {
         if (mode === AppMode.CONVERTER) {
           const blob = await convertAudio(fileItem.file, converterConfig, (p) => {
              setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, progress: p } : f));
           });
           const url = URL.createObjectURL(blob);
           setFiles(prev => prev.map(f => f.id === fileItem.id ? { 
             ...f, 
             status: ProcessingStatus.DONE, 
             progress: 100,
             outputBlob: blob,
             outputUrl: url
           } : f));
         } else if (mode === AppMode.TRANSCRIBER) {
           const text = await transcribeAudio(fileItem.file);
           setTranscription(text);
           setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, status: ProcessingStatus.DONE, progress: 100 } : f));
         }
       } catch (err) {
         setFiles(prev => prev.map(f => f.id === fileItem.id ? { 
           ...f, 
           status: ProcessingStatus.ERROR, 
           error: err instanceof Error ? err.message : "Erreur" 
         } : f));
         addLog(`ERREUR FICHIER: ${fileItem.name} - ${err instanceof Error ? err.message : "Erreur inconnue"}`);
       }
    }
    
    setIsProcessing(false);
    addLog("PROCESS: Traitement terminé. Appel de notifyEnd().");
    notifyEnd();
  };

  const handleTTS = async () => {
    if (!ttsText.trim()) return;
    setIsProcessing(true);
    setError(null);
    setTtsResultUrl(null);

    try {
      const buffer = await generateSpeech(ttsText, ttsVoice);
      const blob = new Blob([buffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      setTtsResultUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de synthèse vocale");
    } finally {
      setIsProcessing(false);
    }
  };

  const reset = () => {
    setFiles([]);
    setTranscription("");
    setError(null);
    setTtsResultUrl(null);
    setDebugLogs([]);
  };

  // Feature: Save to "Convertion" folder with Robust Fallback
  const handleSaveBatch = async () => {
    const processedFiles = files.filter(f => f.status === ProcessingStatus.DONE && f.outputBlob);
    if (processedFiles.length === 0) return;

    // Helper to generate ZIP
    const saveZip = async () => {
      try {
        const zip = new JSZip();
        const folder = zip.folder("Convertion");
        
        processedFiles.forEach(f => {
          const originalName = f.name.substring(0, f.name.lastIndexOf('.')) || f.name;
          const ext = getExtension(converterConfig.format);
          const newName = `${originalName}.${ext}`;
          if (folder && f.outputBlob) {
             folder.file(newName, f.outputBlob);
          }
        });

        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        
        const a = document.createElement("a");
        a.href = url;
        a.download = "Convertion.zip";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (zipErr) {
        setError("Erreur lors de la création du ZIP: " + (zipErr instanceof Error ? zipErr.message : ""));
      }
    };

    // Try File System Access API first
    // @ts-ignore
    if (typeof window.showDirectoryPicker === 'function') {
      try {
        // @ts-ignore
        const dirHandle = await window.showDirectoryPicker();
        const subDirHandle = await dirHandle.getDirectoryHandle('Convertion', { create: true });

        for (const fileItem of processedFiles) {
          const originalName = fileItem.name.substring(0, fileItem.name.lastIndexOf('.')) || fileItem.name;
          const ext = getExtension(converterConfig.format);
          const newName = `${originalName}.${ext}`;
          
          const fileHandle = await subDirHandle.getFileHandle(newName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(fileItem.outputBlob);
          await writable.close();
        }
        alert("Fichiers sauvegardés avec succès dans le dossier 'Convertion' !");
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.warn("L'accès direct au dossier n'est pas permis (probablement une restriction iframe). Basculement vers ZIP.", err);
        await saveZip();
      }
    } else {
      await saveZip();
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col">
      {/* Navbar */}
      <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Wand2 className="text-white" size={18} />
            </div>
            <span className="font-bold text-lg tracking-tight">AudioAlchemy <span className="text-indigo-400">AI</span></span>
          </div>
          
          <div className="hidden md:flex gap-1 p-1 bg-slate-800/50 rounded-xl border border-slate-700/50">
            <TabButton 
              active={mode === AppMode.CONVERTER} 
              onClick={() => {setMode(AppMode.CONVERTER); reset();}}
              icon={<FileAudio size={16} />}
              label="Convertisseur"
            />
            <TabButton 
              active={mode === AppMode.TRANSCRIBER} 
              onClick={() => {setMode(AppMode.TRANSCRIBER); reset();}}
              icon={<MessageSquare size={16} />}
              label="Transcription IA"
            />
            <TabButton 
              active={mode === AppMode.TTS} 
              onClick={() => {setMode(AppMode.TTS); reset();}}
              icon={<Mic size={16} />}
              label="Synthèse (TTS)"
            />
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-12 flex-grow">
        
        {/* Mobile Tabs */}
        <div className="md:hidden flex gap-2 mb-8 overflow-x-auto pb-2">
           <TabButton 
              active={mode === AppMode.CONVERTER} 
              onClick={() => {setMode(AppMode.CONVERTER); reset();}}
              icon={<FileAudio size={16} />}
              label="Convertir"
            />
            <TabButton 
              active={mode === AppMode.TRANSCRIBER} 
              onClick={() => {setMode(AppMode.TRANSCRIBER); reset();}}
              icon={<MessageSquare size={16} />}
              label="Transcrire"
            />
            <TabButton 
              active={mode === AppMode.TTS} 
              onClick={() => {setMode(AppMode.TTS); reset();}}
              icon={<Mic size={16} />}
              label="TTS"
            />
        </div>

        {/* Header Section */}
        <div className="text-center mb-10">
          <h1 className="text-3xl md:text-4xl font-bold mb-3 text-white">
            {mode === AppMode.CONVERTER && "Convertisseur Audio Batch"}
            {mode === AppMode.TRANSCRIBER && "Transcription Intelligente"}
            {mode === AppMode.TTS && "Synthèse Vocale Neuronale"}
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            {mode === AppMode.CONVERTER && "Convertissez des dossiers entiers. Choisissez votre format, nous créons le dossier 'Convertion' pour vous."}
            {mode === AppMode.TRANSCRIBER && "Utilisez la puissance de Gemini 2.5 pour transcrire vos fichiers audio."}
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden mb-8">
          
          {/* TTS Input Mode */}
          {mode === AppMode.TTS ? (
            <div className="p-8">
              <label className="block text-sm font-medium text-slate-300 mb-2">Votre texte</label>
              <textarea
                value={ttsText}
                onChange={(e) => setTtsText(e.target.value)}
                placeholder="Tapez quelque chose à dire..."
                className="w-full h-40 bg-slate-800 border border-slate-700 rounded-xl p-4 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none mb-6"
              />
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Voix</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'].map(v => (
                      <button
                        key={v}
                        onClick={() => setTtsVoice(v)}
                        className={`px-3 py-2 rounded-lg text-sm border transition-all ${
                          ttsVoice === v 
                            ? 'bg-indigo-600 border-indigo-500 text-white' 
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center">
                 {ttsResultUrl && (
                   <div className="flex items-center gap-2">
                     <audio controls src={ttsResultUrl} className="h-10" />
                     <a href={ttsResultUrl} download="tts_output.wav" className="p-2 bg-slate-800 rounded-lg hover:bg-slate-700">
                       <Download size={20} className="text-slate-300"/>
                     </a>
                   </div>
                 )}
                <Button 
                  onClick={handleTTS} 
                  disabled={!ttsText || isProcessing}
                  isLoading={isProcessing}
                  icon={<Wand2 size={18} />}
                  className="w-full md:w-auto"
                >
                  Générer
                </Button>
              </div>
            </div>
          ) : (
            // Upload Mode (Converter & Transcriber)
            <div className="p-8">
              {files.length === 0 ? (
                <UploadZone 
                  onFileSelected={handleFileSelect} 
                  multiple={mode === AppMode.CONVERTER}
                  label={mode === AppMode.CONVERTER ? "Glissez vos fichiers ici pour le traitement par lot" : "Déposez votre fichier audio"}
                />
              ) : (
                <div className="space-y-6">
                  
                  {/* File List */}
                  <div className="bg-slate-800/30 rounded-xl border border-slate-700/50 overflow-hidden max-h-[400px] overflow-y-auto">
                     <div className="px-4 py-3 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/80 sticky top-0 backdrop-blur-sm z-10">
                        <span className="text-sm font-medium text-slate-400">{files.length} fichier(s)</span>
                        <div className="flex gap-2">
                          <button onClick={() => document.getElementById('add-more-input')?.click()} className="text-xs flex items-center gap-1 text-indigo-400 hover:text-indigo-300">
                             <Plus size={14} /> Ajouter
                          </button>
                          <button onClick={reset} className="text-xs text-red-400 hover:text-red-300">Tout effacer</button>
                          {/* Hidden input for adding more */}
                           <input
                            id="add-more-input"
                            type="file"
                            className="hidden"
                            accept="audio/*"
                            multiple
                            onChange={(e) => e.target.files && handleFileSelect(Array.from(e.target.files))}
                          />
                        </div>
                     </div>
                     
                     <div className="divide-y divide-slate-700/50">
                       {files.map(f => (
                         <div key={f.id} className="p-4 flex items-center justify-between hover:bg-slate-800/50 transition-colors">
                            <div className="flex items-center gap-3 overflow-hidden">
                               <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center shrink-0">
                                 {f.status === ProcessingStatus.DONE ? <CheckCircle2 size={20} className="text-green-500"/> : 
                                  f.status === ProcessingStatus.ERROR ? <AlertCircle size={20} className="text-red-500"/> :
                                  <Music size={20} className="text-slate-400"/>}
                               </div>
                               <div className="min-w-0">
                                 <p className="text-sm font-medium text-white truncate max-w-[150px] md:max-w-xs">{f.name}</p>
                                 <p className="text-xs text-slate-500">{(f.size / 1024 / 1024).toFixed(2)} MB</p>
                               </div>
                            </div>

                            <div className="flex items-center gap-4">
                               {f.status === ProcessingStatus.PROCESSING && (
                                 <div className="w-24 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                   <div className="h-full bg-indigo-500" style={{ width: `${f.progress}%` }}></div>
                                 </div>
                               )}
                               
                               {f.status === ProcessingStatus.IDLE && (
                                 <button onClick={() => removeFile(f.id)} className="text-slate-500 hover:text-red-400">
                                   <Trash2 size={16} />
                                 </button>
                               )}

                               {f.status === ProcessingStatus.DONE && f.outputUrl && (
                                 <div className="flex gap-2">
                                   <button onClick={() => {
                                     const audio = new Audio(f.outputUrl);
                                     audio.play();
                                   }} className="p-1.5 bg-slate-700 rounded-md hover:bg-slate-600 text-slate-300">
                                      <Play size={14} />
                                   </button>
                                 </div>
                               )}
                            </div>
                         </div>
                       ))}
                     </div>
                  </div>

                  {/* Converter Configuration Panel (Only in Converter Mode) */}
                  {mode === AppMode.CONVERTER && (
                    <div className="bg-slate-800/30 rounded-xl border border-slate-700/50 overflow-hidden">
                      <div className="bg-slate-800/50 px-6 py-4 border-b border-slate-700/50 flex items-center gap-2">
                         <Sliders size={18} className="text-indigo-400" />
                         <h3 className="font-medium text-white">Configuration globale</h3>
                      </div>
                      
                      <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Format Selection */}
                        <div className="space-y-2">
                           <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1">
                             <FileAudio size={12} /> Format
                           </label>
                           <select 
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none appearance-none"
                              value={converterConfig.format}
                              onChange={(e) => setConverterConfig({...converterConfig, format: e.target.value as AudioFormat})}
                           >
                             <option value={AudioFormat.WAV}>WAV (Sans perte)</option>
                             <option value={AudioFormat.MP3}>MP3</option>
                             <option value={AudioFormat.WEBM}>WebM</option>
                             <option value={AudioFormat.OGG}>OGG</option>
                             <option value={AudioFormat.AAC}>AAC</option>
                             <option value={AudioFormat.FLAC}>FLAC</option>
                           </select>
                        </div>
                        {/* Bitrate Selection */}
                        <div className="space-y-2">
                           <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1">
                             <Gauge size={12} /> Qualité
                           </label>
                           <select 
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none appearance-none disabled:opacity-50"
                              value={converterConfig.bitrate}
                              onChange={(e) => setConverterConfig({...converterConfig, bitrate: Number(e.target.value)})}
                              disabled={converterConfig.format === AudioFormat.WAV || converterConfig.format === AudioFormat.FLAC}
                           >
                             <option value="64">64 kbps</option>
                             <option value="128">128 kbps</option>
                             <option value="192">192 kbps</option>
                             <option value="320">320 kbps</option>
                           </select>
                        </div>
                         {/* Sample Rate Selection */}
                        <div className="space-y-2">
                           <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1">
                             <Activity size={12} /> Fréquence
                           </label>
                           <select 
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none appearance-none"
                              value={converterConfig.sampleRate}
                              onChange={(e) => setConverterConfig({...converterConfig, sampleRate: Number(e.target.value) as SampleRate})}
                           >
                             <option value={SampleRate.HZ_44100}>44100 Hz</option>
                             <option value={SampleRate.HZ_48000}>48000 Hz</option>
                             <option value={SampleRate.HZ_22050}>22050 Hz</option>
                             <option value={SampleRate.HZ_16000}>16000 Hz</option>
                           </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex flex-col sm:flex-row justify-end gap-4 pt-2">
                    {/* Process Button */}
                    {!files.every(f => f.status === ProcessingStatus.DONE) && (
                      <Button 
                        onClick={processBatch} 
                        isLoading={isProcessing}
                        icon={mode === AppMode.CONVERTER ? <Wand2 size={18} /> : <MessageSquare size={18} />}
                      >
                         {mode === AppMode.CONVERTER ? 'Tout convertir' : 'Transcrire'}
                      </Button>
                    )}

                    {/* Save Button (Only for Converter when Done) */}
                    {mode === AppMode.CONVERTER && files.some(f => f.status === ProcessingStatus.DONE) && (
                      <Button 
                        onClick={handleSaveBatch}
                        variant="primary"
                        className="bg-green-600 hover:bg-green-500 shadow-green-900/20"
                        icon={<FolderDown size={18} />}
                      >
                         Sauvegarder le dossier 'Convertion'
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Results Area (Transcription Only) */}
          {(transcription || error) && (
            <div className="border-t border-slate-800 bg-slate-900/50 p-8">
              {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400 mb-4">
                  <AlertCircle size={20} />
                  <span>{error}</span>
                </div>
              )}

              {/* Transcription Result */}
              {transcription && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                   <div className="flex items-center justify-between mb-4">
                      <h3 className="font-medium text-white flex items-center gap-2">
                        <MessageSquare size={18} className="text-indigo-400"/>
                        Résultat
                      </h3>
                      <button 
                        onClick={() => navigator.clipboard.writeText(transcription)}
                        className="text-xs text-slate-400 hover:text-white transition-colors"
                      >
                        Copier
                      </button>
                   </div>
                   <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 text-slate-300 leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                     {transcription}
                   </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* DEBUG CONSOLE SECTION */}
        <div className="mt-8 bg-black/80 rounded-xl border border-slate-800 overflow-hidden font-mono text-xs">
          <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center gap-2 text-slate-400">
            <Terminal size={14} />
            <span className="font-semibold">Console de Débogage Audio</span>
          </div>
          <div className="p-4 h-48 overflow-y-auto space-y-1">
            {debugLogs.length === 0 ? (
              <span className="text-slate-600 italic">En attente de logs...</span>
            ) : (
              debugLogs.map((log, i) => (
                <div key={i} className={`
                  ${log.includes("ERREUR") ? "text-red-400" : ""}
                  ${log.includes("RÉSEAU OK") || log.includes("SUCCÈS") ? "text-green-400" : ""}
                  ${!log.includes("ERREUR") && !log.includes("SUCCÈS") ? "text-slate-300" : ""}
                `}>
                  {log}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Info Footer */}
        <div className="mt-12 text-center text-sm text-slate-600">
          <p>Propulsé par Google Gemini & Web Audio API</p>
        </div>
      </main>
    </div>
  );
}

// Sub-components for cleaner App.tsx

const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`
      flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
      ${active 
        ? 'bg-slate-700 text-white shadow-sm' 
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
      }
    `}
  >
    {icon}
    <span>{label}</span>
  </button>
);