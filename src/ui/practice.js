const roleQuestions = {
  'AI / ML Engineer': [
    ['Behavioral', 'Tell me about a machine learning project you took from an experiment to production.'],
    ['ML systems', 'How would you reduce inference latency while keeping answer quality acceptable?'],
    ['Evaluation', 'How would you detect and respond to model quality drift after deployment?']
  ],
  'MLOps Engineer': [
    ['Behavioral', 'Describe a production incident you helped resolve and what you changed afterward.'],
    ['Operations', 'How would you design safe model rollouts with fast rollback?'],
    ['Reliability', 'Which signals would you monitor for an online inference service?']
  ],
  'Backend Engineer': [
    ['Behavioral', 'Tell me about a difficult reliability issue you solved.'],
    ['Systems', 'How would you design an idempotent API for retrying payment requests?'],
    ['Databases', 'How do you choose between caching, indexing, and query redesign?']
  ],
  'Full-Stack Engineer': [
    ['Behavioral', 'Describe a feature where you had to balance user experience and technical constraints.'],
    ['Frontend', 'How would you keep a large interactive page responsive as its data grows?'],
    ['Architecture', 'How would you decide what belongs on the server versus the client?']
  ],
  'Cloud / DevOps Engineer': [
    ['Behavioral', 'Tell me about a deployment or infrastructure issue and how you prevented a repeat.'],
    ['Infrastructure', 'How would you design a resilient service across multiple availability zones?'],
    ['Operations', 'How do you balance reliability, deployment speed, and cloud cost?']
  ]
};

const roleSelect = document.getElementById('roleSelect');
const questionText = document.getElementById('questionText');
const questionKind = document.getElementById('questionKind');
const questionNumber = document.getElementById('questionNumber');
const answerInput = document.getElementById('answerInput');
const wordCount = document.getElementById('wordCount');
const feedback = document.getElementById('feedback');
let currentQuestion = null;
let questionIndex = -1;
let questionRound = 0;

Object.keys(roleQuestions).forEach(role => roleSelect.add(new Option(role, role)));

function drawQuestion() {
  const questions = roleQuestions[roleSelect.value];
  if (!questions?.length) return;
  questionIndex = (questionIndex + 1) % questions.length;
  currentQuestion = questions[questionIndex];
  questionRound += 1;
  questionKind.textContent = currentQuestion[0];
  questionText.textContent = currentQuestion[1];
  questionNumber.textContent = `Question ${questionRound}`;
  feedback.hidden = true;
}

function setRandomRole() {
  const roles = Object.keys(roleQuestions);
  roleSelect.selectedIndex = Math.floor(Math.random() * roles.length);
  questionIndex = -1;
  drawQuestion();
}

function reviewAnswer() {
  const answer = answerInput.value.trim();
  const words = answer.match(/\b[\w'-]+\b/g) || [];
  if (words.length < 12) {
    feedback.innerHTML = '<h3>Try expanding your practice answer</h3><p>Start with your main point, then add one concrete example and what changed because of your work.</p>';
    feedback.hidden = false;
    return;
  }
  const checks = [
    { label: 'Clear structure', ok: /\b(first|then|finally|because|therefore|situation|task|action|result)\b/i.test(answer), tip: 'Use a simple order: context → your action → result.' },
    { label: 'Specific evidence', ok: /\b(\d+%?|\d+ms|\d+x|latency|throughput|users|customers|revenue|hours|days|weeks)\b/i.test(answer), tip: 'Add a measurable result or a concrete signal when you can.' },
    { label: 'Personal contribution', ok: /\b(I|my|we|our)\b/i.test(answer), tip: 'Make your own decisions and contribution clear.' },
    { label: 'Trade-offs or validation', ok: /\b(test|measure|trade-?off|risk|validate|monitor|alternative|reliab)\w*/i.test(answer), tip: 'Mention how you checked the result or handled a trade-off.' }
  ];
  const score = checks.filter(item => item.ok).length + (words.length >= 45 ? 1 : 0);
  const tips = checks.filter(item => !item.ok).map(item => `<li><strong>${item.label}:</strong> ${item.tip}</li>`);
  if (words.length < 45) tips.push('<li><strong>Depth:</strong> Add one more detail about the challenge and your reasoning.</li>');
  const praise = score >= 4 ? 'Good practice answer: it includes several useful signals.' : 'Useful start. Pick one or two gaps below and try again.';
  feedback.innerHTML = `<h3>Practice checklist</h3><span class="score">${score}/5 signals</span><p>${praise}</p>${tips.length ? `<ul>${tips.join('')}</ul>` : '<p>Try making the result and your reasoning even more concise.</p>'}`;
  feedback.hidden = false;
}

roleSelect.addEventListener('change', () => { questionIndex = -1; drawQuestion(); });
document.getElementById('randomRole').addEventListener('click', setRandomRole);
document.getElementById('nextQuestion').addEventListener('click', () => { answerInput.value = ''; wordCount.textContent = '0 words'; drawQuestion(); });
document.getElementById('reviewAnswer').addEventListener('click', reviewAnswer);
document.getElementById('clearAnswer').addEventListener('click', () => { answerInput.value = ''; wordCount.textContent = '0 words'; feedback.hidden = true; answerInput.focus(); });
answerInput.addEventListener('input', () => { const count = (answerInput.value.trim().match(/\b[\w'-]+\b/g) || []).length; wordCount.textContent = `${count} ${count === 1 ? 'word' : 'words'}`; });
drawQuestion();
