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
  'Machine Learning': [
    'machine learning', 'machine-learning', 'ml', 'ai/ml', 'ml/ai', 'ml models', 'ml model', 'supervised learning', 'unsupervised learning',
    'logistic regression', 'linear regression', 'random forest', 'random forests', 'svm', 'k-means', 'kmeans', 'clustering', 'classification models',
  ],
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
  // more languages
  Dart: ['dart'],
  'Objective-C': ['objective-c', 'objective c'],
  MATLAB: ['matlab'],
  Perl: ['perl'],
  Haskell: ['haskell'],
  Elixir: ['elixir'],
  Solidity: ['solidity'],
  Lua: ['lua'],
  'Embedded C': ['embedded c', 'embedded systems', 'firmware', 'rtos'],
  Verilog: ['verilog', 'systemverilog', 'vhdl', 'fpga'],
  // mobile
  Android: ['android', 'android sdk', 'jetpack compose'],
  iOS: ['ios', 'swiftui', 'uikit', 'xcode'],
  'React Native': ['react native', 'react-native'],
  Flutter: ['flutter'],
  // more frontend
  Svelte: ['svelte', 'sveltekit'],
  jQuery: ['jquery'],
  'Sass/SCSS': ['sass', 'scss', 'less css'],
  Bootstrap: ['bootstrap'],
  'Material UI': ['material ui', 'material-ui', 'mui'],
  Webpack: ['webpack', 'vite', 'rollup', 'babel'],
  'Three.js': ['three.js', 'threejs', 'webgl'],
  WebSockets: ['websocket', 'websockets', 'socket.io'],
  Figma: ['figma'],
  Accessibility: ['accessibility', 'wcag', 'a11y'],
  // more backend / architecture
  'Event-driven architecture': ['event-driven', 'event driven', 'event sourcing', 'cqrs'],
  'Design Patterns': ['design patterns', 'design pattern', 'solid principles'],
  Concurrency: ['concurrency', 'multithreading', 'multi-threading', 'multithreaded', 'parallel programming'],
  'Computer Networking': ['tcp/ip', 'networking protocols', 'computer networks', 'http/2', 'dns'],
  'Operating Systems': ['operating systems', 'operating system internals', 'os internals'],
  Hibernate: ['hibernate', 'jpa'],
  Laravel: ['laravel'],
  'Ruby on Rails': ['ruby on rails', 'rails'],
  Nginx: ['nginx', 'apache httpd', 'load balancer', 'load balancers'],
  'API Design': ['api design', 'openapi', 'swagger'],
  JWT: ['jwt', 'json web token', 'json web tokens'],
  // data engineering / analytics
  Snowflake: ['snowflake'],
  BigQuery: ['bigquery', 'big query'],
  Redshift: ['redshift', 'amazon redshift'],
  Databricks: ['databricks', 'delta lake'],
  dbt: ['dbt'],
  Hadoop: ['hadoop', 'hdfs', 'mapreduce', 'hive', 'presto', 'trino'],
  Flink: ['flink', 'apache flink', 'apache beam', 'beam', 'dataflow'],
  ETL: ['etl', 'elt', 'data pipelines', 'data pipeline', 'data-processing pipelines', 'data processing pipelines', 'data ingestion'],
  'Data Warehousing': ['data warehouse', 'data warehousing', 'data lake', 'data modeling', 'data modelling', 'dimensional modeling'],
  Tableau: ['tableau'],
  'Power BI': ['power bi', 'powerbi'],
  QuickSight: ['quicksight'],
  Looker: ['looker', 'looker studio'],
  Excel: ['excel', 'microsoft excel', 'ms excel', 'advanced excel', 'vba'],
  'Data Analysis': ['data analysis', 'data analytics', 'analytics'],
  Statistics: ['statistics', 'statistical analysis', 'statistical modeling', 'hypothesis testing'],
  'A/B Testing': ['a/b testing', 'a/b tests', 'ab testing', 'experimentation'],
  // AI / ML
  'Reinforcement Learning': ['reinforcement learning', 'rlhf'],
  RAG: ['rag', 'retrieval-augmented generation', 'retrieval augmented generation'],
  'Prompt Engineering': ['prompt engineering', 'prompt design'],
  LangChain: ['langchain', 'llamaindex', 'llama index'],
  'Vector Databases': ['vector database', 'vector databases', 'vector db', 'pinecone', 'faiss', 'weaviate', 'milvus', 'chroma', 'pgvector'],
  MLOps: ['mlops', 'ml ops', 'model deployment', 'model serving', 'kubeflow', 'mlflow'],
  SageMaker: ['sagemaker', 'amazon sagemaker', 'bedrock', 'amazon bedrock'],
  'Vertex AI': ['vertex ai', 'vertexai'],
  XGBoost: ['xgboost', 'lightgbm', 'catboost', 'gradient boosting'],
  JAX: ['jax'],
  CUDA: ['cuda', 'gpu programming'],
  Keras: ['keras'],
  'Fine-tuning': ['fine-tuning', 'fine tuning', 'finetuning', 'lora', 'peft'],
  'AI Agents': ['ai agents', 'agentic', 'llm agents', 'multi-agent', 'tool use', 'function calling'],
  // more databases / messaging
  'SQL Server': ['sql server', 'mssql', 't-sql', 'tsql'],
  Oracle: ['oracle db', 'oracle database', 'pl/sql', 'plsql'],
  SQLite: ['sqlite'],
  Neo4j: ['neo4j', 'graph database', 'graph databases'],
  NoSQL: ['nosql'],
  'AWS SQS/SNS': ['sqs', 'sns', 'kinesis', 'eventbridge'],
  'Pub/Sub': ['pub/sub', 'pubsub', 'google pub/sub'],
  // more cloud / devops
  Ansible: ['ansible'],
  'Chef/Puppet': ['chef', 'puppet'],
  Helm: ['helm', 'helm charts'],
  'Service Mesh': ['istio', 'linkerd', 'service mesh', 'envoy'],
  CloudFormation: ['cloudformation', 'aws cdk', 'cdk', 'pulumi'],
  Serverless: ['serverless', 'cloud functions', 'azure functions'],
  'Infrastructure as Code': ['infrastructure as code', 'iac'],
  ArgoCD: ['argocd', 'argo cd', 'gitops'],
  SRE: ['site reliability', 'sre', 'incident management', 'on-call', 'slos'],
  // testing / tooling / process
  Selenium: ['selenium', 'webdriver'],
  Cypress: ['cypress'],
  Playwright: ['playwright', 'puppeteer'],
  Postman: ['postman', 'api testing'],
  'Performance Testing': ['jmeter', 'load testing', 'performance testing', 'gatling', 'locust'],
  Jira: ['jira', 'confluence'],
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
const AMBIGUOUS = new Set([
  'go', 'r language', 'node', 'express', 'spring', 'rest', 'swift', 'rust', 'ruby', 'ts', 'tf', 'ml', 'metrics', 'logging',
  'monitoring', 'security', 'containers', 'torch', 'lambda', 'c language',
  // ordinary words that are also product names
  'excel', 'chef', 'puppet', 'helm', 'beam', 'dart', 'rails', 'chroma', 'envoy', 'agentic', 'tool use', 'analytics', 'experimentation',
  'statistics', 'accessibility', 'dns', 'iac', 'cdk', 'on-call', 'rag', 'hive', 'presto', 'snowflake', 'bootstrap', 'flutter', 'looker', 'jax', 'lua',
])

/**
 * Knowing a tool implies the field it belongs to: a resume listing PyTorch
 * covers a job asking for "machine learning". One direction only — asking for
 * machine learning doesn't mean the job wants PyTorch.
 */
const IMPLIES: Record<string, string[]> = {
  PyTorch: ['Machine Learning', 'Deep Learning'],
  TensorFlow: ['Machine Learning', 'Deep Learning'],
  Keras: ['Machine Learning', 'Deep Learning'],
  JAX: ['Machine Learning'],
  'scikit-learn': ['Machine Learning'],
  XGBoost: ['Machine Learning'],
  'Deep Learning': ['Machine Learning'],
  'Computer Vision': ['Machine Learning'],
  NLP: ['Machine Learning'],
  Transformers: ['Machine Learning', 'NLP'],
  'Fine-tuning': ['Machine Learning', 'LLMs'],
  RAG: ['LLMs'],
  LangChain: ['LLMs'],
  'AI Agents': ['LLMs'],
  Pandas: ['Data Analysis'],
  'Power BI': ['Data Analysis'],
  Tableau: ['Data Analysis'],
  QuickSight: ['Data Analysis'],
  Looker: ['Data Analysis'],
  'Spring Boot': ['Java'],
  Django: ['Python'],
  Flask: ['Python'],
  FastAPI: ['Python'],
  'Next.js': ['React'],
  Kubernetes: ['Docker'],
  'GitHub Actions': ['CI/CD'],
  Jenkins: ['CI/CD'],
  MySQL: ['SQL'],
  PostgreSQL: ['SQL'],
  'SQL Server': ['SQL'],
}

/** A set of skills plus everything they imply. */
export function withImplied(skills: Iterable<string>): Set<string> {
  const out = new Set(skills)
  for (const s of [...out]) for (const p of IMPLIES[s] ?? []) out.add(p)
  return out
}

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
      const techNearby = /\b(api|apis|framework|frameworks|language|languages|backend|service|services|stack|developer|engineer|cloud|sdk|java|python|javascript|sql|data|database|databases|tools?|dashboards?|pipelines?|kubernetes|docker|aws|gcp|azure|devops|tableau|power bi|spark|llms?|models?|testing)\b/i.test(window)
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
