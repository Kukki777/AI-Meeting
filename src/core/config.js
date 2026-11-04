const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// 1. Load internal bundled .env
const bundledEnv = path.join(__dirname, '../../.env');
if (fs.existsSync(bundledEnv)) {
  dotenv.config({ path: bundledEnv });
}

// 2. Load external .env next to executable if present (allows user to easily override keys)
try {
  const externalEnv = path.join(path.dirname(process.execPath), '.env');
  if (fs.existsSync(externalEnv) && externalEnv !== bundledEnv) {
    dotenv.config({ path: externalEnv, override: true });
  }
} catch (_) {}

class Config {
  constructor() {
    this.groqApiKey = process.env.GROQ_API_KEY || '';
    this.geminiApiKey = process.env.GEMINI_API_KEY || '';
    this.deepgramApiKey = process.env.DEEPGRAM_API_KEY || '';
    
    // Model preferences
    this.primaryLLM = process.env.PRIMARY_LLM || 'groq'; // 'groq' | 'gemini'
    this.groqModel = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
    this.groqWhisperModel = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3';
    this.geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
    
    // Default Role Profile (Dynamic)
    this.defaultRole = {
      title: 'Senior AI / Machine Learning Engineer',
      seniority: 'Senior / Staff (6+ years experience)',
      specializations: [
        'LLM Fine-Tuning & Quantization (LoRA, QLoRA, AWQ, FP8)',
        'Inference Serving (vLLM, TensorRT-LLM, Continuous Batching, PagedAttention)',
        'RAG Architectures (Vector DBs, Hybrid Search, GraphRAG)',
        'Distributed Training (PyTorch FSDP, DeepSpeed, Megatron-LM)',
        'MLOps & Kubernetes (Kubeflow, Triton Inference Server)'
      ],
      preferredLanguage: 'Python / C++',
      tone: 'Crisp, highly competent, production-minded, no filler'
    };
  }

  getRole() {
    return this.defaultRole;
  }

  setRole(newRole) {
    this.defaultRole = { ...this.defaultRole, ...newRole };
  }
}

module.exports = new Config();
