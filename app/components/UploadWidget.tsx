/**
 * Upload Widget Component
 *
 * Features:
 * - Modal using shadcn Dialog component
 * - Drag-and-drop zone with visual drop indicator
 * - Accept PDF, PNG, JPG files only (validate on drop/select)
 * - Multiple files uploaded together as a single document
 * - Form fields for Title, Notes, and Tags
 * - Show progress bar during upload
 * - Use XHR to POST files to /api/documents/upload with progress tracking
 */

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { X, Upload, FileText, Image, Camera, RefreshCw, ArrowLeft } from 'lucide-react';
import { getSession, clearSession, isAuthenticated } from '../utils/auth';

interface UploadWidgetProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadComplete?: () => void;
}

const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB

export function UploadWidget({ isOpen, onClose, onUploadComplete }: UploadWidgetProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  // Camera capture state
  const [captureMode, setCaptureMode] = useState<'upload' | 'camera'>('upload');
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [showFlash, setShowFlash] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const validateFile = (file: File): { valid: boolean; error?: string } => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return { valid: false, error: 'Invalid file type. Only PDF, PNG, and JPG files are allowed.' };
    }
    if (file.size > MAX_FILE_SIZE) {
      return { valid: false, error: 'File size exceeds 1GB limit.' };
    }
    return { valid: true };
  };

  const addFiles = (newFiles: FileList | File[]) => {
    const fileArray = Array.from(newFiles);

    // Validate all files
    for (const file of fileArray) {
      const validation = validateFile(file);
      if (!validation.valid) {
        setUploadError(validation.error || 'File validation failed');
        return;
      }
    }

    setFiles((prev) => [...prev, ...fileArray]);
    setUploadError(null);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      setUploadError('Please select at least one file');
      return;
    }

    // Check if session is valid before upload
    if (!isAuthenticated()) {
      clearSession();
      window.location.href = '/login';
      return;
    }

    const token = getSession();
    if (!token) {
      setUploadError('Not authenticated');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    // Create FormData
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });

    if (title.trim()) {
      formData.append('title', title.trim());
    }
    if (notes.trim()) {
      formData.append('notes', notes.trim());
    }
    if (tags.trim()) {
      formData.append('tags', tags.trim());
    }

    // Create XHR for progress tracking
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    // Track upload progress
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percentComplete = (e.loaded / e.total) * 100;
        setUploadProgress(percentComplete);
      }
    });

    // Handle completion
    xhr.addEventListener('load', () => {
      // Handle 401 Unauthorized - session expired
      if (xhr.status === 401) {
        clearSession();
        window.location.href = '/login';
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        setUploadSuccess(true);
        setUploadProgress(100);
        onUploadComplete?.();

        // Reset form after brief delay
        setTimeout(() => {
          handleClose();
        }, 1500);
      } else {
        try {
          const error = JSON.parse(xhr.responseText);
          setUploadError(error.error || 'Upload failed');
        } catch {
          setUploadError('Upload failed');
        }
        setIsUploading(false);
      }
    });

    // Handle errors
    xhr.addEventListener('error', () => {
      setUploadError('Network error');
      setIsUploading(false);
    });

    // Send request
    xhr.open('POST', '/api/documents/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
  };

  const handleClose = () => {
    // Cancel upload if in progress
    if (isUploading && xhrRef.current) {
      xhrRef.current.abort();
    }

    // Stop camera if active
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }

    // Reset state
    setFiles([]);
    setTitle('');
    setNotes('');
    setTags('');
    setIsUploading(false);
    setUploadProgress(0);
    setUploadError(null);
    setUploadSuccess(false);
    xhrRef.current = null;

    // Reset camera state
    setCaptureMode('upload');
    setCameraError(null);

    onClose();
  };

  // Camera functions
  const getCameraErrorMessage = (error: unknown): string => {
    if (error instanceof DOMException) {
      switch (error.name) {
        case 'NotAllowedError':
          return 'Camera access denied. Please allow camera permissions in your browser settings.';
        case 'NotFoundError':
          return 'No camera found on this device.';
        case 'NotReadableError':
          return 'Camera is in use by another application.';
        case 'OverconstrainedError':
          return 'Camera does not support the requested settings.';
        case 'SecurityError':
          return 'Camera access blocked due to security restrictions.';
        default:
          return `Camera error: ${error.message}`;
      }
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'Failed to access camera';
  };

  const startCamera = async () => {
    setIsCameraLoading(true);
    setCameraError(null);

    let stream: MediaStream | null = null;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access is not supported in this browser');
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };

      stream = await navigator.mediaDevices.getUserMedia(constraints);
      setCameraStream(stream);

      const video = videoRef.current;
      if (!video) {
        throw new Error('Video element not available');
      }

      video.srcObject = stream;

      // Wait for video to be ready to play with timeout
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error('Camera took too long to start'));
        }, 10000);

        const cleanup = () => {
          clearTimeout(timeoutId);
          video.removeEventListener('canplay', onCanPlay);
          video.removeEventListener('error', onError);
        };

        const onCanPlay = () => {
          cleanup();
          resolve();
        };

        const onError = () => {
          cleanup();
          reject(new Error('Video stream error'));
        };

        // Check if already ready
        if (video.readyState >= 3) {
          cleanup();
          resolve();
          return;
        }

        video.addEventListener('canplay', onCanPlay);
        video.addEventListener('error', onError);
      });

      await video.play();
    } catch (error) {
      const errorMessage = getCameraErrorMessage(error);
      setCameraError(errorMessage);
      // Clean up stream if we got one but failed later
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setCameraStream(null);
      }
    } finally {
      setIsCameraLoading(false);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context) return;

    // Check if video has valid dimensions
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError('Camera not ready. Please wait a moment and try again.');
      return;
    }

    // Trigger flash effect
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 150);

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw the current video frame
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert to blob and create File object
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError('Failed to capture photo');
          return;
        }

        // Generate unique filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `camera-capture-${timestamp}.jpg`;

        // Create File object
        const file = new File([blob], filename, { type: 'image/jpeg' });

        // Add to files array using existing addFiles function
        addFiles([file]);
      },
      'image/jpeg',
      0.92
    );
  };

  const switchCamera = () => {
    stopCamera();
    setFacingMode(prev => (prev === 'user' ? 'environment' : 'user'));
  };

  const handleModeChange = (mode: 'upload' | 'camera') => {
    if (mode === captureMode) return;

    if (captureMode === 'camera') {
      stopCamera();
    }

    setCaptureMode(mode);
    setCameraError(null);
  };

  // Camera lifecycle effects
  useEffect(() => {
    if (captureMode === 'camera' && !cameraStream && !isCameraLoading && !cameraError) {
      startCamera();
    }
  }, [captureMode, facingMode, cameraStream, isCameraLoading, cameraError]);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setCaptureMode('upload');
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  const getFileIcon = (fileType: string) => {
    if (fileType === 'application/pdf') {
      return <FileText className="w-5 h-5" />;
    }
    return <Image className="w-5 h-5" />;
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
          <DialogDescription>
            Upload files or capture photos to create a single searchable document.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1">
          {/* Mode Toggle */}
          <div className="flex gap-2">
            <Button
              variant={captureMode === 'upload' ? 'default' : 'outline'}
              onClick={() => handleModeChange('upload')}
              disabled={isUploading}
              className="flex-1"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Files
            </Button>
            <Button
              variant={captureMode === 'camera' ? 'default' : 'outline'}
              onClick={() => handleModeChange('camera')}
              disabled={isUploading}
              className="flex-1"
            >
              <Camera className="w-4 h-4 mr-2" />
              Camera
            </Button>
          </div>

          {/* Upload Mode: Drag and Drop Zone */}
          {captureMode === 'upload' && (
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
              } ${isUploading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !isUploading && fileInputRef.current?.click()}
            >
              <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground mb-1">
                Drag and drop files here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground">PDF, PNG, JPG up to 1GB each</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={handleFileSelect}
                className="hidden"
                disabled={isUploading}
              />
            </div>
          )}

          
          {/* Selected Files */}
          {files.length > 0 && (
            <div className="space-y-2">
              <Label>Selected Files ({files.length})</Label>
              <div className="max-h-32 overflow-y-auto space-y-2">
                {files.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center justify-between border rounded p-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {getFileIcon(file.type)}
                      <span className="text-sm truncate">{file.name}</span>
                    </div>
                    {!isUploading && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeFile(index)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Title Field */}
          <div className="space-y-2">
            <Label htmlFor="title">Title (optional)</Label>
            <Input
              id="title"
              placeholder="Enter document title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isUploading}
            />
          </div>

          {/* Notes Field */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional, searchable)</Label>
            <Textarea
              id="notes"
              placeholder="Add notes about this document"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isUploading}
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              Notes will be vectorized and included in search results
            </p>
          </div>

          {/* Tags Field */}
          <div className="space-y-2">
            <Label htmlFor="tags">Tags (optional)</Label>
            <Input
              id="tags"
              placeholder="work, important, receipts (comma-separated)"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              disabled={isUploading}
            />
          </div>

          {/* Upload Progress */}
          {isUploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Uploading...</span>
                <span>{Math.round(uploadProgress)}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Success Message */}
          {uploadSuccess && (
            <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">
              Upload successful! Processing document...
            </div>
          )}

          {/* Error Message */}
          {uploadError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
              {uploadError}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isUploading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={isUploading || files.length === 0}
          >
            {isUploading ? 'Uploading...' : 'Upload'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* Hidden canvas for camera capture - must be outside Dialog for reliable access */}
    <canvas ref={canvasRef} className="hidden" />

    {/* Fullscreen Camera Mode - rendered in portal to layer above Dialog */}
    {isOpen && captureMode === 'camera' && typeof document !== 'undefined' && createPortal(
      <div
        className="fixed inset-0 z-[100] bg-black flex flex-col"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Flash effect overlay */}
        {showFlash && (
          <div className="absolute inset-0 bg-white z-50 pointer-events-none animate-flash" />
        )}

        {/* Top bar with back button and photo count */}
        <div className="absolute top-0 left-0 right-0 z-10 p-4 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleModeChange('upload')}
            className="text-white hover:bg-white/20 rounded-full w-10 h-10"
          >
            <ArrowLeft className="w-6 h-6" />
          </Button>
          {files.length > 0 && (
            <div className="bg-white/20 text-white px-3 py-1 rounded-full text-sm font-medium">
              {files.length} photo{files.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {/* Camera Error */}
        {cameraError && (
          <div className="absolute top-20 left-4 right-4 z-10 p-3 bg-red-500/90 rounded-lg text-sm text-white">
            {cameraError}
            <Button
              variant="link"
              className="ml-2 p-0 h-auto text-white underline"
              onClick={startCamera}
            >
              Try again
            </Button>
          </div>
        )}

        {/* Camera Preview - fills the screen */}
        <div className="flex-1 flex items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover pointer-events-none"
          />
          {/* Loading overlay */}
          {isCameraLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              <div className="animate-pulse text-center">
                <Camera className="w-12 h-12 mx-auto text-white/60 mb-3" />
                <p className="text-sm text-white/60">Starting camera...</p>
              </div>
            </div>
          )}
        </div>

        {/* Bottom controls */}
        <div className="absolute bottom-0 left-0 right-0 z-10 pb-8 pt-4 bg-gradient-to-t from-black/60 to-transparent pointer-events-auto">
          <div className="flex justify-center items-center gap-8">
            <Button
              variant="ghost"
              onClick={switchCamera}
              disabled={!cameraStream || isCameraLoading}
              size="icon"
              className="rounded-full w-12 h-12 text-white hover:bg-white/20"
              title="Switch camera"
            >
              <RefreshCw className="w-6 h-6" />
            </Button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                capturePhoto();
              }}
              disabled={!cameraStream || isCameraLoading}
              className="rounded-full w-20 h-20 bg-white hover:bg-gray-200 border-4 border-white/30 flex items-center justify-center"
            >
              <div className="w-16 h-16 rounded-full bg-white border-2 border-gray-300 pointer-events-none" />
            </button>
            <Button
              variant="ghost"
              onClick={() => handleModeChange('upload')}
              disabled={files.length === 0}
              size="icon"
              className="rounded-full w-12 h-12 text-white hover:bg-white/20"
              title="Done"
            >
              {files.length > 0 ? (
                <span className="text-sm font-medium">Done</span>
              ) : (
                <div className="w-6 h-6" />
              )}
            </Button>
          </div>
          <p className="text-xs text-center text-white/70 mt-4">
            Tap to capture. Take multiple photos for multi-page documents.
          </p>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}
