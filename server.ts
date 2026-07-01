import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { initializeApp, cert } from "firebase-admin/app";

// Inicialização do Firebase Admin SDK
try {
  const serviceAccountPath = path.resolve(process.cwd(), "serviceAccountKey.json");
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));
    initializeApp({
      credential: cert(serviceAccount)
    });
    console.log(`🔥 Firebase Admin inicializado com sucesso (${serviceAccount.client_email})`);
  } else {
    console.warn("⚠️  Aviso: Arquivo serviceAccountKey.json não encontrado na raiz do projeto. O Firebase Admin não foi inicializado.");
  }
} catch (error) {
  console.error("❌ Erro ao inicializar o Firebase Admin:", error);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Aumentar o limite de payload para imagens em base64
  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.post("/api/dica-do-dia", async (req, res) => {
    try {
      const { profile, workouts, meals } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not set." });
      }

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const prompt = `Você é um personal trainer e nutricionista virtual de um aplicativo chamado FitFlow. 
Gere uma "Dica do Dia" curta e motivadora (no máximo 2-3 frases) com base no perfil do usuário.
Perfil: 
- Nome: ${profile?.name || 'Usuário'}
- Nível: ${profile?.level || 1}
- Objetivo: ${profile?.goal || 'Não definido'}
- Treinos planejados: ${workouts?.length || 0}
- Refeições planejadas: ${meals?.length || 0}

A dica deve ser personalizada, amigável e usar emojis. Fale diretamente com o usuário pelo nome.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
      });

      res.json({ tip: response.text });
    } catch (error: any) {
      console.error("Error generating tip:", error);
      res.status(500).json({ error: "Failed to generate tip of the day." });
    }
  });

  app.post("/api/analyze-meal", async (req, res) => {
    try {
      const { foodName, image } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not set." });
      }

      if (!foodName && !image) {
        return res.status(400).json({ error: "Provide foodName or image." });
      }

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const prompt = `Atue como um nutricionista especializado. 
      Analise o alimento fornecido e estime a quantidade aproximada de calorias e macronutrientes para uma porção padrão.
      Responda **APENAS** com um objeto JSON no exato formato:
      {"name": "Nome bonito do prato", "calories": 300, "protein": 25, "carbs": 40, "fat": 10}
      Os valores de protein, carbs e fat devem ser em gramas.
      Não adicione formatação markdown ou texto extra.`;

      let contents: any[] = [];
      
      if (image) {
        // Formato esperado: data:image/jpeg;base64,...
        const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
        const mimeType = image.match(/^data:(image\/\w+);base64,/)?.[1] || "image/jpeg";
        contents = [
          prompt,
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType
            }
          }
        ];
        if (foodName) {
          contents.unshift(`Nome providenciado pelo usuário: ${foodName}`);
        }
      } else {
        contents = [`Alimento: ${foodName}\n\n${prompt}`];
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: contents,
      });

      let responseText = response.text || "";
      // Limpar formatação json se a IA teimar em colocar
      responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

      const jsonResult = JSON.parse(responseText);

      res.json(jsonResult);
    } catch (error: any) {
      console.error("Error analyzing meal:", error);
      res.status(500).json({ error: "Failed to analyze meal." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
