import React, { useRef, useState } from 'react';
import { Upload, Music } from 'lucide-react';

interface UploadZoneProps {
  onFileSelected: (files: File[]) => void;
  accept?: string;
  label?: string;
  multiple?: boolean;
}

export const UploadZone: React.FC<UploadZoneProps> = ({ 
  onFileSelected, 
  accept = "audio/*",
  label = "Déposez vos fichiers audio ici ou cliquez pour parcourir",
  multiple = false
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files);
      onFileSelected(filesArray);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      onFileSelected(filesArray);
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative overflow-hidden group cursor-pointer
        border-2 border-dashed rounded-xl p-12
        flex flex-col items-center justify-center text-center
        transition-all duration-300 ease-in-out
        ${isDragging 
          ? 'border-indigo-500 bg-indigo-500/10' 
          : 'border-slate-700 hover:border-indigo-400 hover:bg-slate-800/50'
        }
      `}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        onChange={handleInputChange}
      />
      
      <div className={`p-4 rounded-full mb-4 transition-colors ${isDragging ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-400 group-hover:text-indigo-400 group-hover:bg-slate-700'}`}>
        <Upload size={32} />
      </div>
      
      <h3 className="text-lg font-medium text-slate-200 mb-2">
        {isDragging ? 'Relâchez pour ajouter' : 'Importer des fichiers'}
      </h3>
      <p className="text-sm text-slate-500 max-w-xs mx-auto">
        {label}
      </p>
      
      <div className="mt-6 flex gap-3 text-xs text-slate-600 font-mono">
        <span className="px-2 py-1 rounded bg-slate-800">MP3</span>
        <span className="px-2 py-1 rounded bg-slate-800">WAV</span>
        <span className="px-2 py-1 rounded bg-slate-800">Batch</span>
      </div>
    </div>
  );
};