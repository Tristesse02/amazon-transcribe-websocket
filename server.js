import express from "express";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from "@aws-sdk/client-transcribe-streaming";
import cors from "cors";

// import { fileURLToPath } from "url";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

const app = express();  
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "http://localhost:4000", methods: ["GET", "POST"] },
});

// app.use(express.static(path.join(__dirname)));
app.use(cors());

// app.get("/", (req, res) => {
//   res.sendFile(path.join(__dirname, "index.html"));
// });

// Create an Amazon Transcribe Streaming Client
const transcribeClient = new TranscribeStreamingClient({
  region: "us-east-2", // Ensure this matches your AWS region
});

io.on("connection", (socket) => {
  console.log("A user connected");

  let audioStream;
  let lastTranscript = "";
  let isTranscribing = false;

  // Stream small chunks (1024 bytes) of audio to Amazon Transcribe
  socket.on("startTranscription", async () => {
    console.log("Starting transcription");
    isTranscribing = true;
    let buffer = Buffer.from("");

    audioStream = async function* () {
      while (isTranscribing) {
        const chunk = await new Promise((resolve) =>
          socket.once("audioData", resolve)
        );
        if (chunk === null) break;
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        console.log("Received audio chunk, buffer size:", buffer.length);

        while (buffer.length >= 1024) {
          yield { AudioEvent: { AudioChunk: buffer.slice(0, 1024) } };
          buffer = buffer.slice(1024);
        }
      }
    };

    // Configures the transcription request
    const command = new StartStreamTranscriptionCommand({
      LanguageCode: "en-US",
      MediaSampleRateHertz: 44100,
      MediaEncoding: "pcm",
      AudioStream: audioStream(),
    });

    // Send the transcription [Focus here]
    try {
      console.log("Sending command to AWS Transcribe");
      const response = await transcribeClient.send(command);
      console.log("Received response from AWS Transcribe");

      for await (const event of response.TranscriptResultStream) {
        if (!isTranscribing) break;
        if (event.TranscriptEvent) {
          console.log(
            "Received TranscriptEvent:",
            JSON.stringify(event.TranscriptEvent)
          );
          const results = event.TranscriptEvent.Transcript.Results;
          if (results.length > 0 && results[0].Alternatives.length > 0) {
            const transcript = results[0].Alternatives[0].Transcript;
            const isFinal = !results[0].IsPartial;

            if (isFinal) {
              console.log("Emitting final transcription:", transcript);
              socket.emit("transcription", { text: transcript, isFinal: true });
              lastTranscript = transcript;
            } else {
              const newPart = transcript.substring(lastTranscript.length);
              if (newPart.trim() !== "") {
                console.log("Emitting partial transcription:", newPart);
                socket.emit("transcription", { text: newPart, isFinal: false });
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Transcription error:", error);
      socket.emit("error", "Transcription error occurred: " + error.message);
    }
  });

  socket.on("audioData", (data, callback) => {
    if (isTranscribing) {
      console.log("Received audioData event, data size:", data.byteLength);
      socket.emit("audioData", data);

      if (callback) {
        callback("Audio data received successfully!");
      }
    }
  });

  socket.on("stopTranscription", () => {
    console.log("Stopping transcription");
    isTranscribing = false;
    audioStream = null;
    lastTranscript = "";
  });

  socket.on("disconnect", (reason) => {
    console.log("Stopping transcription", reason);
    console.log("User disconnected");
    isTranscribing = false;
    audioStream = null;
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
