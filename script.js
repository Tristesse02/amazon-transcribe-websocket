const socket = io();
let audioContext;
let audioInput;
let processor;
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const clearButton = document.getElementById("clearButton");
const statusText = document.getElementById("statusText");
const statusIndicator = document.getElementById("statusIndicator");
const transcript = document.getElementById("transcript");

let currentTranscript = "";
let lastFinalIndex = 0;

startButton.addEventListener("click", startRecording);
stopButton.addEventListener("click", stopRecording);
clearButton.addEventListener("click", clearTranscript);

function updateStatus(status) {
  console.log("Status updated:", status);
  statusText.textContent = status;
  statusIndicator.textContent = status === "Recording" ? "🔴" : "⚪";
}

async function startRecording() {
  console.log("Start button clicked");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("Microphone access granted");
    audioContext = new AudioContext();
    audioInput = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(1024, 1, 1);
    audioInput.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (e) => {
      const float32Array = e.inputBuffer.getChannelData(0);
      const int16Array = new Int16Array(float32Array.length);
      for (let i = 0; i < float32Array.length; i++) {
        int16Array[i] = Math.max(
          -32768,
          Math.min(32767, Math.floor(float32Array[i] * 32768))
        );
      }
      console.log(
        "Sending audio chunk to server, size:",
        int16Array.buffer.byteLength
      );
      socket.emit("audioData", int16Array.buffer);
    };

    socket.emit("startTranscription");
    console.log("startTranscription event emitted");
    updateStatus("Recording");
  } catch (error) {
    console.error("Error accessing microphone:", error);
    updateStatus("Error: " + error.message);
  }
}

function stopRecording() {
  console.log("Stop button clicked");
  if (audioContext && audioContext.state !== "closed") {
    audioInput.disconnect();
    processor.disconnect();
    audioContext.close();
    socket.emit("stopTranscription");
    updateStatus("Not recording");
  }
}

function clearTranscript() {
  console.log("Clear button clicked");
  currentTranscript = "";
  lastFinalIndex = 0;
  transcript.textContent = "";
}

socket.on("transcription", (data) => {
  console.log("Received transcription:", data);
  if (data.isFinal) {
    currentTranscript += data.text + " ";
    lastFinalIndex = currentTranscript.length;
  } else {
    const partialTranscript = currentTranscript + data.text;
    transcript.textContent = partialTranscript;
  }
  transcript.textContent = currentTranscript;
});

socket.on("error", (errorMessage) => {
  console.error("Server error:", errorMessage);
  transcript.textContent += "\nError: " + errorMessage;
});

console.log("Client-side script loaded");
