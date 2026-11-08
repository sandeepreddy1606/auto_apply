/**
 * Skill dictionary: canonical name → aliases. Used to find technologies in job
 * descriptions and resume bullets, so "k8s" and "Kubernetes" count as one skill
 * and the resume guards can tell when a rewrite names a new technology.
 *
 * Pure module: no I/O, safe to import from client code and tests.
 */

const DICT: Record<string, string[]> = {
  // languages
  Java: ['java'],
  Python: ['python', 'python3'],
  JavaScript: ['javascript', 'js', 'es6', 'ecmascript'],
  TypeScript: ['typescript', 'ts'],
  'C++': ['c++', 'cpp'],
  'C#': ['c#', 'csharp', 'c sharp'],
  C: ['c language', 'ansi c'],
  Go: ['golang', 'go lang'],
  Rust: ['rust'],
  Kotlin: ['kotlin'],
  Swift: ['swift'],
  Scala: ['scala'],
  Ruby: ['ruby'],
  PHP: ['php'],
  SQL: ['sql'],
  'Bash/Shell': ['bash', 'shell scripting', 'shell script', 'powershell'],
  R: ['r language', 'r programming'],
  // backend / frameworks
  'Spring Boot': ['spring boot', 'springboot', 'spring framework', 'spring'],
  'Node.js': ['node.js', 'nodejs', 'node js', 'node'],
  Express: ['express.js', 'expressjs', 'express'],
  FastAPI: ['fastapi', 'fast api'],
  Flask: ['flask'],
  Django: ['django'],
  '.NET': ['.net', 'dotnet', 'asp.net', '.net core', 'asp.net core'],
  NestJS: ['nestjs', 'nest.js'],
  GraphQL: ['graphql'],
  gRPC: ['grpc'],
  'REST APIs': ['rest', 'restful', 'rest api', 'rest apis', 'restful api', 'restful apis'],
  Microservices: ['microservices', 'microservice', 'micro-services'],
  'System Design': ['system design', 'distributed systems', 'distributed system'],
  OOP: ['object-oriented', 'object oriented', 'oop', 'ood', 'object-oriented design'],
  // frontend
  React: ['react', 'react.js', 'reactjs'],
  'Next.js': ['next.js', 'nextjs'],
  Angular: ['angular'],
  'Vue.js': ['vue', 'vue.js', 'vuejs'],
  'HTML/CSS': ['html', 'css', 'html5', 'css3'],
  Redux: ['redux'],
  Tailwind: ['tailwind', 'tailwindcss'],
  // data / ML
  'Machine Learning': ['machine learning', 'ml'],
  'Deep Learning': ['deep learning'],
  PyTorch: ['pytorch', 'torch'],
  TensorFlow: ['tensorflow', 'tf'],
  'scikit-learn': ['scikit-learn', 'sklearn', 'scikit learn'],
  Pandas: ['pandas'],
  NumPy: ['numpy'],
  OpenCV: ['opencv'],
  NLP: ['nlp', 'natural language processing'],
  'Computer Vision': ['computer vision'],
  LLMs: ['llm', 'llms', 'large language model', 'large language models', 'genai', 'generative ai', 'llm apis'],
  Transformers: ['transformers', 'bert', 'hugging face', 'huggingface'],
  Spark: ['spark', 'pyspark', 'apache spark'],
  Airflow: ['airflow'],
  // databases
  MySQL: ['mysql'],
  PostgreSQL: ['postgresql', 'postgres'],
  MongoDB: ['mongodb', 'mongo'],
  Redis: ['redis'],
  Cassandra: ['cassandra'],
  DynamoDB: ['dynamodb'],
  Elasticsearch: ['elasticsearch', 'elastic search', 'opensearch'],
  Firebase: ['firebase', 'firestore'],
  // cloud / devops
  AWS: ['aws', 'amazon web services', 'ec2', 's3', 'lambda'],
  Azure: ['azure', 'microsoft azure'],
  GCP: ['gcp', 'google cloud', 'google cloud platform'],
  OCI: ['oci', 'oracle cloud', 'oracle cloud infrastructure'],
  Docker: ['docker', 'containers', 'containerization', 'containerise', 'containerize', 'containerised', 'containerized'],
  Kubernetes: ['kubernetes', 'k8s', 'eks', 'aks', 'gke'],
  Terraform: ['terraform'],
  'CI/CD': ['ci/cd', 'cicd', 'ci cd', 'continuous integration', 'continuous delivery', 'continuous deployment'],
  'GitHub Actions': ['github actions'],
  Jenkins: ['jenkins'],
  Git: ['git', 'github', 'gitlab', 'bitbucket'],
  Linux: ['linux', 'unix'],
  Kafka: ['kafka', 'apache kafka'],
  RabbitMQ: ['rabbitmq'],
  // practices
  'Unit Testing': ['unit testing', 'unit tests', 'unit test', 'junit', 'pytest', 'jest', 'xunit'],
  'Integration Testing': ['integration testing', 'integration tests'],
  'Agile/Scrum': ['agile', 'scrum'],
  'Code Review': ['code review', 'code reviews', 'peer review', 'peer reviews'],
  Observability: ['observability', 'monitoring', 'logging', 'metrics', 'prometheus', 'grafana'],
  Security: ['security', 'secure coding', 'authentication', 'authorization', 'oauth'],
  'Data Structures & Algorithms': ['data structures', 'algorithms', 'dsa'],
}

/** Aliases that are ordinary English words — only counted in clearly technical context. */
const AMBIGUOUS = new Set(['go', 'r language', 'node', 'express', 'spring', 'rest', 'swift', 'rust', 'ruby', 'ts', 'tf', 'ml', 'metrics', 'logging', 'monitoring', 'security', 'containers', 'torch', 'lambda', 'c language'])

interface Matcher {
  canonical: string
  re: RegExp
  ambiguous: boolean
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const MATCHERS: Matcher[] = Object.entries(DICT).flatMap(([canonical, aliases]) =>
  [canonical.toLowerCase(), ...aliases].map((alias) => ({
    canonical,
    // Word-ish boundaries that also respect symbols inside names (c++, c#, .net, node.js).
    re: new RegExp(`(?<![a-z0-9+#.])${escapeRe(alias)}(?![a-z0-9+#]|\\.[a-z])`, 'i'),
    ambiguous: AMBIGUOUS.has(alias),
  })),
)

const CANONICAL_BY_LOWER = new Map<string, string>()
for (const [canonical, aliases] of Object.entries(DICT)) {
  CANONICAL_BY_LOWER.set(canonical.toLowerCase(), canonical)
  for (const a of aliases) if (!CANONICAL_BY_LOWER.has(a)) CANONICAL_BY_LOWER.set(a, canonical)
}

/**
 * Canonical skills mentioned in free text. Ambiguous aliases ("Go", "Rest",
 * "Spring") count only when another technical term is nearby or the alias is
 * capitalised like a product name.
 */
export function extractSkills(text: string): string[] {
  const found = new Set<string>()
  if (!text) return []
  for (const m of MATCHERS) {
    if (found.has(m.canonical)) continue
    const hit = m.re.exec(text)
    if (!hit) continue
    if (m.ambiguous) {
      const raw = hit[0]
      const capitalised = /^[A-Z]/.test(raw) || raw.toUpperCase() === raw
      const window = text.slice(Math.max(0, hit.index - 60), hit.index + raw.length + 60)
      const techNearby = /\b(api|apis|framework|language|backend|service|services|stack|developer|engineer|cloud|sdk|java|python|javascript)\b/i.test(window)
      if (!(capitalised && techNearby) && !(m.canonical === 'REST APIs' && /\bapis?\b|restful/i.test(window))) continue
    }
    found.add(m.canonical)
  }
  return [...found].sort()
}

/** Map a user-typed skill to its canonical name (or keep it as typed). */
export function canonicalSkill(s: string): string {
  const k = s.trim().toLowerCase().replace(/\s+/g, ' ')
  return CANONICAL_BY_LOWER.get(k) ?? s.trim()
}

/** Canonical names for a list of user skills (comma lists, resume skill lines, …). */
export function canonicalSkills(list: string[]): Set<string> {
  const out = new Set<string>()
  for (const raw of list) {
    for (const part of raw.split(/[,;/|\n]/)) {
      const p = part.trim()
      if (!p) continue
      const c = canonicalSkill(p)
      if (CANONICAL_BY_LOWER.has(c.toLowerCase()) || DICT[c]) out.add(c)
      // Phrases such as "working knowledge of C# and .NET" still name skills.
      for (const s of extractSkills(p)) out.add(s)
    }
  }
  return out
}

export const SKILL_NAMES = Object.keys(DICT)
