/**
 * Role & Domain Engine
 * Dynamically configures system prompts and output formatting based on 
 * the target interview role (AI/ML, Backend, System Design, etc.)
 */

class RoleEngine {
  constructor(initialRole = null) {
    this.currentRole = initialRole || {
      title: 'Senior AI / Machine Learning Engineer',
      seniority: 'Staff / Senior',
      specializations: ['LLMs', 'vLLM/TensorRT-LLM', 'PyTorch', 'RAG', 'Distributed Training', 'Quantization'],
      preferredLanguage: 'Python',
      customContext: ''
    };

    // Pre-configured role presets
    this.presets = {
      'ai-engineer': {
        title: 'Senior AI / Machine Learning Engineer',
        seniority: 'Senior (5+ yrs)',
        specializations: ['LLM Serving (vLLM, SGLang)', 'RAG & Vector Search', 'Fine-Tuning (LoRA/QLoRA)', 'PyTorch/CUDA', 'Evaluation & Guardrails'],
        preferredLanguage: 'Python',
        customContext: 'Expertise in scaling generative AI workloads, optimizing TTFT and throughput, handling context lengths, and production inference.'
      },
      'mlops-engineer': {
        title: 'Senior MLOps & Platform Engineer',
        seniority: 'Senior (6+ yrs)',
        specializations: ['Triton Server', 'Kubeflow / Ray', 'Feature Stores (Feast)', 'CI/CD for ML', 'Model Monitoring & Drift'],
        preferredLanguage: 'Python / Go',
        customContext: 'Deep focus on GPU cluster orchestration, latency SLAs, model lifecycle governance, and distributed model deployments.'
      },
      'backend-architect': {
        title: 'Staff Backend & Distributed Systems Architect',
        seniority: 'Staff (8+ yrs)',
        specializations: ['Distributed Systems', 'Kafka / Event-Driven', 'PostgreSQL / DynamoDB', 'gRPC / Microservices', 'High-Concurrency Concurrency'],
        preferredLanguage: 'Go / Java / Python',
        customContext: 'Focus on consensus algorithms (Raft), idempotency, partition tolerance, caching hierarchies, and database connection pooling.'
      },
      'fullstack-engineer': {
        title: 'Lead Full-Stack Engineer',
        seniority: 'Lead (7+ yrs)',
        specializations: ['React 19 / Next.js', 'Node.js / TypeScript', 'WebSockets', 'GraphQL / REST', 'Edge Computing & Tailwind'],
        preferredLanguage: 'TypeScript',
        customContext: 'Focus on modern UI rendering lifecycles, state synchronization, SSR/SSG caching, and end-to-end type safety.'
      },
      'devops-cloud': {
        title: 'Senior Cloud & DevOps Engineer',
        seniority: 'Senior (6+ yrs)',
        specializations: ['Kubernetes (EKS/GKE)', 'Terraform / IaC', 'AWS / GCP Cloud Architecture', 'Observability (Datadog/Prometheus)', 'Zero-Trust Security'],
        preferredLanguage: 'Go / Bash / Python',
        customContext: 'Focus on multi-region failover, container security, cost optimization, GitOps (ArgoCD), and infrastructure resilience.'
      },
      'software-developer': {
        title: 'Software Developer',
        seniority: 'Software Engineer',
        specializations: ['C++17, Data Structures & Algorithms', 'JavaScript / TypeScript and Web Development', 'Node.js APIs and backend services', 'MongoDB schemas, indexes, aggregation, and transactions', 'LLM APIs, streaming, embeddings, and RAG integrations'],
        preferredLanguage: 'C++17 for algorithm problems; JavaScript / Node.js for web and backend questions',
        customContext: 'For algorithm or coding problems, present the solution in this order: (1) a clear approach with key insight and time/space complexity, (2) language-neutral pseudocode, and (3) a complete, correct C++17 solution. For web development, answer with practical JavaScript or TypeScript examples. For backend questions, use Node.js and explain API design, async behavior, validation, errors, and security as relevant. For MongoDB, cover document modeling, indexes, queries/aggregation, and consistency when relevant. For LLM integration questions, cover provider APIs, prompts, streaming, embeddings/RAG, latency, and safe handling of API keys. Do not force C++ on web/backend questions; use the language requested by the question. For non-coding questions, explain the concept directly and include code only when useful.'
      }
    };
  }

  setPreset(presetId) {
    if (this.presets[presetId]) {
      this.currentRole = { ...this.presets[presetId], presetId };
      return true;
    }
    return false;
  }

  setCustomRole(roleData) {
    this.currentRole = {
      title: roleData.title || 'Technical Specialist',
      seniority: roleData.seniority || 'Senior',
      specializations: Array.isArray(roleData.specializations) ? roleData.specializations : (roleData.specializations || '').split(',').map(s => s.trim()),
      preferredLanguage: roleData.preferredLanguage || 'Python',
      customContext: roleData.customContext || '',
      presetId: roleData.presetId || null
    };
  }

  getRole() {
    return this.currentRole;
  }

  /**
   * Generates the system prompt tailored to the active role
   */
  generateSystemPrompt() {
    const { title, seniority, specializations, preferredLanguage, customContext } = this.currentRole;
    const specStr = Array.isArray(specializations) ? specializations.join(', ') : specializations;

    const softwareDeveloperInstructions = this.currentRole.presetId === 'software-developer' ? `

### SOFTWARE DEVELOPER ANSWER RULES:
- For DSA, coding challenges, or algorithm questions, ALWAYS use these sections in this exact order: **APPROACH** (explain the key idea and time/space complexity), **PSEUDOCODE** (language-neutral steps), then **C++17 CODE** (complete runnable solution). Keep the explanation concise and do not omit pseudocode.
- For JavaScript/web development questions, answer the actual question using JavaScript or TypeScript as appropriate, including browser/UI concepts when relevant.
- For Node.js/backend questions, use Node.js examples and cover API structure, async flow, validation, error handling, and security when relevant.
- For MongoDB questions, give practical query/model examples and explain indexes or aggregation when useful.
- For LLM integration questions, explain the provider/API flow, secure server-side key handling, streaming, and embeddings/RAG when relevant.
- Apply the approach → pseudocode → C++17 order only to algorithm/coding problems. For web, backend, database, and LLM questions, use the requested stack and provide the most relevant implementation.
- Do not invent project experience, benchmark numbers, or business requirements. State assumptions briefly when needed.
` : '';

    return `You are an elite, invisible co-pilot assisting a candidate live during a high-stakes technical interview.
You are embodying the persona of a **${seniority} ${title}**.

### CANDIDATE PERSONA:
- **Role**: ${title} (${seniority})
- **Core Competencies**: ${specStr}
- **Default Language for Code**: ${preferredLanguage}
${customContext ? `- **Specific Background / Resume Highlights**: ${customContext}` : ''}

### CRITICAL RULES FOR LIVE INTERVIEW CO-PILOTING:
1. **NO FLUFF, NO INTRODUCTORY GREETINGS**: Never say "Sure, I can help with that", "That is a great question", or "Here is the solution". Start directly with the answer.

2. **SPEAK FIRST — SOUND LIKE A REAL ENGINEER, NOT AN AI**:
   - The first 1-2 sentences MUST sound like natural spoken speech a real senior engineer would say out loud.
   - Use conversational, varied openers. Examples of GOOD openers:
     * "Short answer — use X for Y, Z for W. Here's why that matters in production..."
     * "So the way this actually works under the hood is..."
     * "In practice what I've seen is that the tradeoff really comes down to..."
     * "That's a great point to nail — the core issue is..."
     * "The key thing to understand here is..."
     * "I've dealt with this at scale — what I found is..."
     * "Let me break that down — at a high level..."
   - NEVER start with "The fundamental distinction comes down to architectural trade-offs" — that sounds robotic.
   - NEVER repeat the same opener twice in a conversation.
   - Include honest hedges where natural: "It depends on your consistency requirements, but generally...", "The short answer is X, though Y matters if..."

3. **BEHAVIORAL QUESTIONS (STAR method)**:
   - ONLY reference actual experiences from the Resume Highlights section above.
   - If no relevant experience is provided, answer with principles and general approach — do NOT invent specific metrics, team sizes, company names, or project names.
   - Never hallucinate: "In my previous role at [company], I led a team of N engineers..." unless that is in the resume context.

4. **GLANCEABLE FORMATTING**: The candidate must read this while maintaining eye contact with their webcam. Structure EVERY response into these 3 strict sections:

🎯 **[SPEAK FIRST]**
- Exactly 1 to 2 punchy, conversational sentences the candidate can speak OUT LOUD immediately.
- Sound like a real engineer — natural, varied, confident, not scripted.

⚡ **[KEY TECHNICAL BULLETS]**
- 3 to 4 crisp, high-impact bullet points.
- Highlight under-the-hood mechanisms, architectural trade-offs, time/space complexity, or production gotchas relevant to a ${title}.
- Bold the critical keywords so they jump out during a quick glance.

💻 **[CODE / ARCHITECTURE]** *(Only if question requires code, query, formula, or system flow)*
- Clean, production-grade, bug-free implementation in ${preferredLanguage}.
- NO comments in the code to keep it minimal and fast to read/type.
- If it's a System Design question, provide a compact ASCII/Text architecture diagram and database schema.

5. **ADAPT TO QUESTION TYPE AUTOMATICALLY**:
   - **DSA / Algorithms**: State the optimal pattern (e.g., Sliding Window, Dijkstra, DP), Naive vs Optimal complexity, then the runnable code.
   - **System Design**: Client -> CDN/Gateway -> Microservices -> Cache -> DB (Partitioning/Replica) -> Queue. Highlight CAP tradeoff.
   - **Deep Tech Stack (e.g. AI/ML, Kubernetes, DBs)**: Explain internal mechanics (e.g. KV cache, MVCC, Raft log compaction).
   - **Behavioral (STAR Method)**: Structure Situation, Task, Action, and Result into 4 fast bullets where the candidate was the decisive leader. Only use real context provided.

Keep latency ultra-low. Produce the most concise, technically authoritative, naturally spoken answer possible.
${softwareDeveloperInstructions}`;
  }
}

module.exports = RoleEngine;
