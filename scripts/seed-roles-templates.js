const { GoogleGenAI } = require("../apps/http-server/node_modules/@google/genai");

const AUTH_TOKEN = "";
const BASE_URL = "http://localhost:3001/api";
const GEMINI_API_KEY = "";
const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Role-specific tech stacks and descriptions
const ROLE_TEMPLATES = {
  "Full Stack Developer": {
    tech: "Next.js, Node.js, TypeScript, MySQL, React.js, Tailwind CSS, Redux, Zustand",
    exp: "full-stack development, building both frontend and backend for scalable web applications",
    skills: "React.js, Next.js, TypeScript, Tailwind CSS, and modern state management solutions like Redux and Zustand"
  },
  "Frontend Developer": {
    tech: "React.js, Next.js, TypeScript, Tailwind CSS, Jest, React Testing Library",
    exp: "frontend development, building responsive and interactive user interfaces for scalable web applications",
    skills: "React.js, Next.js, TypeScript, Tailwind CSS, and modern state management solutions like Redux and Zustand"
  },
  "Backend Developer": {
    tech: "Node.js, Express.js, TypeScript, MySQL, PostgreSQL, MongoDB",
    exp: "backend development, building scalable and robust server-side applications",
    skills: "RESTful API design, database optimization, microservices architecture, and cloud deployment"
  },
  "Web Developer": {
    tech: "HTML5, CSS3, JavaScript, React.js, Node.js, MySQL",
    exp: "web development, building responsive websites and web applications",
    skills: "HTML5, CSS3, JavaScript, React.js, and responsive design principles"
  },
  "Software Engineer": {
    tech: "Java, Python, C++, Git, Docker, Kubernetes",
    exp: "software engineering, designing and implementing scalable software solutions",
    skills: "data structures, algorithms, system design, and software architecture"
  },
  "React Developer": {
    tech: "React.js, Redux, TypeScript, Jest, React Testing Library, Webpack",
    exp: "React development, building component-based user interfaces",
    skills: "React.js, hooks, context API, Redux, and performance optimization"
  },
  "Next.js Developer": {
    tech: "Next.js, React.js, TypeScript, Tailwind CSS, Vercel, Prisma",
    exp: "Next.js development, building server-rendered React applications",
    skills: "Next.js, SSR, SSG, API routes, and modern React patterns"
  },
  "Vue.js Developer": {
    tech: "Vue.js, Vuex, Nuxt.js, TypeScript, Vuetify, Pinia",
    exp: "Vue.js development, building reactive user interfaces",
    skills: "Vue.js, Vuex, Composition API, and Vue ecosystem tools"
  },
  "Angular Developer": {
    tech: "Angular, TypeScript, RxJS, NgRx, Angular Material",
    exp: "Angular development, building enterprise-scale applications",
    skills: "Angular, TypeScript, RxJS, dependency injection, and Angular CLI"
  },
  "Node.js Developer": {
    tech: "Node.js, Express.js, NestJS, MongoDB, PostgreSQL, Redis",
    exp: "Node.js development, building scalable backend services",
    skills: "Node.js, Express.js, RESTful APIs, GraphQL, and microservices"
  },
  "TypeScript Developer": {
    tech: "TypeScript, JavaScript, Node.js, React.js, Angular",
    exp: "TypeScript development, building type-safe applications",
    skills: "TypeScript, advanced types, generics, and type-safe architecture"
  },
  "JavaScript Developer": {
    tech: "JavaScript, ES6+, Node.js, React.js, Vue.js",
    exp: "JavaScript development, building modern web applications",
    skills: "JavaScript, ES6+, async programming, and modern frameworks"
  },
  "Python Developer": {
    tech: "Python, Django, Flask, FastAPI, PostgreSQL, Redis",
    exp: "Python development, building backend services and automation tools",
    skills: "Python, Django/Flask, REST APIs, and data processing"
  },
  "Java Developer": {
    tech: "Java, Spring Boot, Hibernate, Maven, MySQL, Kafka",
    exp: "Java development, building enterprise applications",
    skills: "Java, Spring Boot, microservices, and enterprise patterns"
  },
  "Go Developer": {
    tech: "Go, Gin, gRPC, PostgreSQL, Docker, Kubernetes",
    exp: "Go development, building high-performance backend services",
    skills: "Go, concurrency, microservices, and cloud-native development"
  },
  "C++ Developer": {
    tech: "C++, STL, CMake, Boost, Qt, OpenGL",
    exp: "C++ development, building high-performance applications",
    skills: "C++, memory management, multithreading, and optimization"
  },
  "C# Developer": {
    tech: "C#, .NET Core, ASP.NET, Entity Framework, SQL Server",
    exp: "C# development, building enterprise applications",
    skills: "C#, .NET Core, ASP.NET, and Microsoft ecosystem"
  },
  "PHP Developer": {
    tech: "PHP, Laravel, Symfony, MySQL, Redis, Composer",
    exp: "PHP development, building web applications and APIs",
    skills: "PHP, Laravel, MVC patterns, and database optimization"
  },
  "Ruby on Rails Developer": {
    tech: "Ruby, Rails, PostgreSQL, Redis, Sidekiq, RSpec",
    exp: "Ruby on Rails development, building web applications",
    skills: "Ruby, Rails, ActiveRecord, and test-driven development"
  },
  "Django Developer": {
    tech: "Python, Django, Django REST Framework, PostgreSQL, Celery",
    exp: "Django development, building scalable web applications",
    skills: "Django, ORM, REST APIs, and Python best practices"
  },
  "Spring Boot Developer": {
    tech: "Java, Spring Boot, Spring Security, Hibernate, MySQL, Kafka",
    exp: "Spring Boot development, building microservices",
    skills: "Spring Boot, microservices, JPA, and enterprise integration"
  },
  "NestJS Developer": {
    tech: "NestJS, TypeScript, TypeORM, PostgreSQL, GraphQL, Redis",
    exp: "NestJS development, building scalable Node.js applications",
    skills: "NestJS, TypeScript, dependency injection, and modular architecture"
  },
  "Express.js Developer": {
    tech: "Node.js, Express.js, MongoDB, PostgreSQL, JWT, Socket.io",
    exp: "Express.js development, building RESTful APIs",
    skills: "Express.js, middleware, authentication, and API design"
  },
  "ASP.NET Developer": {
    tech: "C#, ASP.NET Core, Entity Framework, SQL Server, Azure",
    exp: "ASP.NET development, building enterprise web applications",
    skills: "ASP.NET Core, MVC, Web API, and Azure deployment"
  },
  "WordPress Developer": {
    tech: "WordPress, PHP, MySQL, JavaScript, WooCommerce, Elementor",
    exp: "WordPress development, building custom themes and plugins",
    skills: "WordPress, custom theme development, plugin development, and SEO"
  },
  "Shopify Developer": {
    tech: "Shopify, Liquid, JavaScript, GraphQL, Shopify CLI",
    exp: "Shopify development, building e-commerce solutions",
    skills: "Shopify, Liquid templates, app development, and e-commerce optimization"
  },
  "Wix Developer": {
    tech: "Wix, Velo, JavaScript, Wix APIs, Corvid",
    exp: "Wix development, building custom web solutions",
    skills: "Wix, Velo by Wix, custom functionality, and integrations"
  },
  "Mobile App Developer": {
    tech: "React Native, Flutter, Swift, Kotlin, Firebase",
    exp: "mobile app development, building cross-platform applications",
    skills: "React Native/Flutter, mobile UI/UX, and app store deployment"
  },
  "React Native Developer": {
    tech: "React Native, TypeScript, Redux, Expo, Firebase",
    exp: "React Native development, building cross-platform mobile apps",
    skills: "React Native, mobile UI components, navigation, and native modules"
  },
  "Flutter Developer": {
    tech: "Flutter, Dart, Firebase, Provider, Bloc",
    exp: "Flutter development, building beautiful cross-platform apps",
    skills: "Flutter, Dart, state management, and custom widgets"
  },
  "iOS Developer": {
    tech: "Swift, SwiftUI, UIKit, Core Data, Xcode",
    exp: "iOS development, building native iPhone and iPad applications",
    skills: "Swift, SwiftUI, iOS SDK, and App Store deployment"
  },
  "Android Developer": {
    tech: "Kotlin, Jetpack Compose, Android SDK, Room, Retrofit",
    exp: "Android development, building native Android applications",
    skills: "Kotlin, Jetpack, MVVM architecture, and Play Store deployment"
  },
  "Kotlin Developer": {
    tech: "Kotlin, Android SDK, Coroutines, Ktor, Spring Boot",
    exp: "Kotlin development, building Android and backend applications",
    skills: "Kotlin, coroutines, functional programming, and multiplatform"
  },
  "Swift Developer": {
    tech: "Swift, SwiftUI, Combine, Core Data, CloudKit",
    exp: "Swift development, building Apple platform applications",
    skills: "Swift, SwiftUI, iOS/macOS development, and Apple frameworks"
  },
  "DevOps Engineer": {
    tech: "Docker, Kubernetes, Jenkins, Terraform, AWS, GitHub Actions",
    exp: "DevOps engineering, implementing CI/CD pipelines and infrastructure automation",
    skills: "CI/CD, containerization, infrastructure as code, and cloud platforms"
  },
  "Cloud Engineer": {
    tech: "AWS, Azure, GCP, Terraform, Docker, Kubernetes",
    exp: "cloud engineering, designing and managing cloud infrastructure",
    skills: "cloud architecture, IaC, serverless, and multi-cloud strategies"
  },
  "AWS Engineer": {
    tech: "AWS, EC2, S3, Lambda, RDS, CloudFormation, EKS",
    exp: "AWS engineering, building and managing AWS infrastructure",
    skills: "AWS services, serverless architecture, and AWS best practices"
  },
  "Azure Engineer": {
    tech: "Azure, Azure DevOps, AKS, Azure Functions, ARM Templates",
    exp: "Azure engineering, building and managing Azure infrastructure",
    skills: "Azure services, Azure DevOps, and Microsoft cloud solutions"
  },
  "GCP Engineer": {
    tech: "GCP, Compute Engine, Cloud Functions, BigQuery, GKE",
    exp: "GCP engineering, building and managing Google Cloud infrastructure",
    skills: "GCP services, data engineering, and Google Cloud best practices"
  },
  "Cloud Architect": {
    tech: "AWS, Azure, GCP, Terraform, Kubernetes, microservices",
    exp: "cloud architecture, designing scalable and resilient cloud solutions",
    skills: "cloud design patterns, cost optimization, and enterprise architecture"
  },
  "Solutions Architect": {
    tech: "AWS, Azure, system design, microservices, enterprise integration",
    exp: "solutions architecture, designing end-to-end technical solutions",
    skills: "system design, technical leadership, and stakeholder communication"
  },
  "Site Reliability Engineer (SRE)": {
    tech: "Kubernetes, Prometheus, Grafana, Terraform, Python, Go",
    exp: "SRE, ensuring system reliability and implementing automation",
    skills: "observability, incident management, SLOs/SLIs, and automation"
  },
  "Infrastructure Engineer": {
    tech: "Linux, Docker, Kubernetes, Terraform, Ansible, AWS",
    exp: "infrastructure engineering, building and maintaining IT infrastructure",
    skills: "infrastructure automation, networking, and system administration"
  },
  "Platform Engineer": {
    tech: "Kubernetes, Docker, Terraform, ArgoCD, Backstage",
    exp: "platform engineering, building internal developer platforms",
    skills: "platform development, developer experience, and automation"
  },
  "CI/CD Engineer": {
    tech: "Jenkins, GitHub Actions, GitLab CI, ArgoCD, Docker",
    exp: "CI/CD engineering, implementing deployment pipelines",
    skills: "pipeline design, automation, and deployment strategies"
  },
  "Data Scientist": {
    tech: "Python, TensorFlow, PyTorch, scikit-learn, Pandas, SQL",
    exp: "data science, building predictive models and deriving insights",
    skills: "machine learning, statistical analysis, and data visualization"
  },
  "Data Engineer": {
    tech: "Python, Apache Spark, Airflow, Kafka, Snowflake, dbt",
    exp: "data engineering, building data pipelines and infrastructure",
    skills: "ETL, data modeling, big data technologies, and data warehousing"
  },
  "Machine Learning Engineer": {
    tech: "Python, TensorFlow, PyTorch, MLflow, Kubernetes, AWS SageMaker",
    exp: "ML engineering, deploying machine learning models to production",
    skills: "MLOps, model deployment, feature engineering, and optimization"
  },
  "AI Engineer": {
    tech: "Python, TensorFlow, PyTorch, LangChain, OpenAI API, Hugging Face",
    exp: "AI engineering, building AI-powered applications",
    skills: "LLMs, prompt engineering, AI integration, and model fine-tuning"
  },
  "Deep Learning Engineer": {
    tech: "Python, TensorFlow, PyTorch, CUDA, neural networks",
    exp: "deep learning, building and training neural network models",
    skills: "CNN, RNN, transformers, and deep learning optimization"
  },
  "Computer Vision Engineer": {
    tech: "Python, OpenCV, TensorFlow, PyTorch, YOLO, MediaPipe",
    exp: "computer vision, building image and video processing systems",
    skills: "image processing, object detection, and visual recognition"
  },
  "NLP Engineer": {
    tech: "Python, Hugging Face, spaCy, NLTK, transformers, BERT",
    exp: "NLP engineering, building natural language processing systems",
    skills: "text processing, language models, and conversational AI"
  },
  "Data Analyst": {
    tech: "SQL, Python, Tableau, Power BI, Excel, Pandas",
    exp: "data analysis, extracting insights from data",
    skills: "SQL, data visualization, statistical analysis, and reporting"
  },
  "Business Intelligence Engineer": {
    tech: "SQL, Tableau, Power BI, Looker, dbt, Snowflake",
    exp: "BI engineering, building dashboards and analytics solutions",
    skills: "data modeling, dashboard design, and business analytics"
  },
  "AI Researcher": {
    tech: "Python, PyTorch, TensorFlow, LaTeX, research frameworks",
    exp: "AI research, advancing the state of artificial intelligence",
    skills: "research methodology, paper writing, and experimental design"
  },
  "Research Engineer": {
    tech: "Python, C++, research frameworks, experimental tools",
    exp: "research engineering, implementing research prototypes",
    skills: "prototyping, experimentation, and research-to-production"
  },
  "Prompt Engineer": {
    tech: "LLMs, OpenAI API, LangChain, prompt optimization",
    exp: "prompt engineering, optimizing AI model interactions",
    skills: "prompt design, LLM optimization, and AI application development"
  },
  "Cybersecurity Engineer": {
    tech: "SIEM, Firewalls, IDS/IPS, Python, Splunk, AWS Security",
    exp: "cybersecurity engineering, protecting systems and data",
    skills: "threat detection, security architecture, and incident response"
  },
  "Security Analyst": {
    tech: "SIEM, Splunk, Wireshark, vulnerability scanners",
    exp: "security analysis, monitoring and analyzing security threats",
    skills: "threat analysis, log analysis, and security monitoring"
  },
  "Security Engineer": {
    tech: "AWS Security, Azure Security, IAM, encryption, SAST/DAST",
    exp: "security engineering, implementing security controls",
    skills: "security architecture, DevSecOps, and compliance"
  },
  "Penetration Tester": {
    tech: "Burp Suite, Metasploit, Nmap, Kali Linux, OWASP",
    exp: "penetration testing, identifying security vulnerabilities",
    skills: "ethical hacking, vulnerability assessment, and security testing"
  },
  "Ethical Hacker": {
    tech: "Kali Linux, Burp Suite, Metasploit, Python, networking",
    exp: "ethical hacking, finding and reporting security vulnerabilities",
    skills: "penetration testing, vulnerability research, and security assessment"
  },
  "Application Security Engineer": {
    tech: "SAST, DAST, OWASP, secure coding, threat modeling",
    exp: "application security, securing software applications",
    skills: "secure SDLC, code review, and application security testing"
  },
  "Network Security Engineer": {
    tech: "Firewalls, VPN, IDS/IPS, Cisco, Palo Alto, network protocols",
    exp: "network security, protecting network infrastructure",
    skills: "network architecture, firewall management, and threat prevention"
  },
  "QA Engineer": {
    tech: "Selenium, Jest, Cypress, Postman, JIRA, TestRail",
    exp: "quality assurance, ensuring software quality through testing",
    skills: "test planning, test automation, and quality processes"
  },
  "Automation Engineer": {
    tech: "Selenium, Cypress, Playwright, Python, Jenkins",
    exp: "test automation, building automated testing frameworks",
    skills: "test automation, CI/CD integration, and framework design"
  },
  "SDET (Software Development Engineer in Test)": {
    tech: "Java, Python, Selenium, TestNG, REST Assured, Docker",
    exp: "SDET, building test infrastructure and automation",
    skills: "test framework development, API testing, and DevOps integration"
  },
  "Manual Tester": {
    tech: "JIRA, TestRail, Postman, browser dev tools, SQL",
    exp: "manual testing, ensuring software quality through thorough testing",
    skills: "test case design, exploratory testing, and bug reporting"
  },
  "Performance Tester": {
    tech: "JMeter, Gatling, LoadRunner, Grafana, monitoring tools",
    exp: "performance testing, ensuring application scalability",
    skills: "load testing, performance analysis, and optimization"
  },
  "Test Architect": {
    tech: "test frameworks, automation strategies, CI/CD, quality metrics",
    exp: "test architecture, designing testing strategies and frameworks",
    skills: "test strategy, framework design, and quality leadership"
  },
  "UI/UX Designer": {
    tech: "Figma, Sketch, Adobe XD, Prototyping, User Research",
    exp: "UI/UX design, creating intuitive user experiences",
    skills: "user research, wireframing, prototyping, and design systems"
  },
  "Product Designer": {
    tech: "Figma, Sketch, design systems, prototyping, user research",
    exp: "product design, designing end-to-end product experiences",
    skills: "product thinking, design systems, and user-centered design"
  },
  "UI Designer": {
    tech: "Figma, Sketch, Adobe Creative Suite, design systems",
    exp: "UI design, creating beautiful and functional interfaces",
    skills: "visual design, typography, color theory, and design systems"
  },
  "UX Researcher": {
    tech: "user interviews, surveys, usability testing, analytics tools",
    exp: "UX research, understanding user needs and behaviors",
    skills: "research methodology, data analysis, and insight generation"
  },
  "Product Manager": {
    tech: "JIRA, Confluence, analytics tools, roadmapping tools",
    exp: "product management, driving product strategy and execution",
    skills: "product strategy, stakeholder management, and data-driven decisions"
  },
  "Technical Product Manager": {
    tech: "JIRA, technical documentation, APIs, system architecture",
    exp: "technical product management, bridging business and engineering",
    skills: "technical leadership, API design, and engineering collaboration"
  },
  "Project Manager": {
    tech: "JIRA, Asana, MS Project, Agile, Scrum",
    exp: "project management, delivering projects on time and budget",
    skills: "project planning, risk management, and team coordination"
  },
  "Program Manager": {
    tech: "program management tools, strategic planning, stakeholder management",
    exp: "program management, coordinating multiple projects",
    skills: "strategic planning, cross-functional leadership, and program delivery"
  },
  "Scrum Master": {
    tech: "JIRA, Confluence, Agile, Scrum, Kanban",
    exp: "Scrum mastery, facilitating Agile teams",
    skills: "Agile coaching, facilitation, and continuous improvement"
  },
  "System Architect": {
    tech: "system design, microservices, cloud architecture, UML",
    exp: "system architecture, designing complex technical systems",
    skills: "architectural patterns, system design, and technical leadership"
  },
  "Systems Engineer": {
    tech: "Linux, networking, virtualization, automation, scripting",
    exp: "systems engineering, managing and optimizing IT systems",
    skills: "system administration, automation, and infrastructure management"
  },
  "Embedded Systems Engineer": {
    tech: "C, C++, RTOS, ARM, microcontrollers, embedded Linux",
    exp: "embedded systems development, building firmware and hardware interfaces",
    skills: "embedded C/C++, real-time systems, and hardware integration"
  },
  "Hardware Engineer": {
    tech: "PCB design, Verilog, VHDL, FPGA, circuit design",
    exp: "hardware engineering, designing electronic systems",
    skills: "circuit design, PCB layout, and hardware debugging"
  },
  "IoT Engineer": {
    tech: "Arduino, Raspberry Pi, MQTT, AWS IoT, sensors",
    exp: "IoT engineering, building connected devices and systems",
    skills: "embedded systems, cloud connectivity, and sensor integration"
  },
  "Firmware Developer": {
    tech: "C, C++, assembly, RTOS, microcontrollers, debugging tools",
    exp: "firmware development, programming embedded devices",
    skills: "low-level programming, hardware interfaces, and optimization"
  },
  "Blockchain Developer": {
    tech: "Solidity, Ethereum, Web3.js, Hardhat, smart contracts",
    exp: "blockchain development, building decentralized applications",
    skills: "smart contracts, DeFi, and blockchain architecture"
  },
  "Smart Contract Developer": {
    tech: "Solidity, Ethereum, Hardhat, OpenZeppelin, Foundry",
    exp: "smart contract development, building secure blockchain contracts",
    skills: "Solidity, contract security, and DeFi protocols"
  },
  "Rust Developer": {
    tech: "Rust, Cargo, async/await, WebAssembly, systems programming",
    exp: "Rust development, building safe and performant systems",
    skills: "Rust, memory safety, concurrency, and systems programming"
  },
  "Solidity Developer": {
    tech: "Solidity, Ethereum, EVM, Hardhat, Foundry, DeFi",
    exp: "Solidity development, building Ethereum smart contracts",
    skills: "Solidity, gas optimization, and smart contract security"
  },
  "Game Developer": {
    tech: "Unity, Unreal Engine, C#, C++, game physics",
    exp: "game development, creating interactive gaming experiences",
    skills: "game engines, 3D graphics, and gameplay programming"
  },
  "Unity Developer": {
    tech: "Unity, C#, game physics, 3D/2D graphics, AR/VR",
    exp: "Unity development, building games and interactive applications",
    skills: "Unity, C# scripting, and game optimization"
  },
  "Unreal Engine Developer": {
    tech: "Unreal Engine, C++, Blueprints, 3D graphics, game physics",
    exp: "Unreal Engine development, building AAA quality games",
    skills: "Unreal Engine, C++, Blueprints, and graphics programming"
  },
  "AR/VR Developer": {
    tech: "Unity, Unreal Engine, ARKit, ARCore, Oculus SDK",
    exp: "AR/VR development, building immersive experiences",
    skills: "spatial computing, 3D interaction, and XR development"
  },
  "3D Developer": {
    tech: "Three.js, WebGL, Blender, Unity, 3D modeling",
    exp: "3D development, creating 3D graphics and visualizations",
    skills: "3D graphics, WebGL, and real-time rendering"
  },
  "Graphics Programmer": {
    tech: "OpenGL, DirectX, Vulkan, HLSL, GLSL, rendering",
    exp: "graphics programming, building rendering engines and visual effects",
    skills: "shader programming, rendering pipelines, and optimization"
  },
  "Database Administrator (DBA)": {
    tech: "PostgreSQL, MySQL, Oracle, MongoDB, performance tuning",
    exp: "database administration, managing and optimizing databases",
    skills: "database optimization, backup/recovery, and security"
  },
  "Database Engineer": {
    tech: "PostgreSQL, MySQL, data modeling, query optimization, replication",
    exp: "database engineering, designing and building database systems",
    skills: "database design, performance tuning, and scalability"
  },
  "ETL Developer": {
    tech: "Apache Airflow, dbt, Spark, SQL, Python, data pipelines",
    exp: "ETL development, building data transformation pipelines",
    skills: "data pipelines, SQL, and data transformation"
  },
  "Big Data Engineer": {
    tech: "Apache Spark, Hadoop, Kafka, Hive, Flink, data lakes",
    exp: "big data engineering, processing large-scale data",
    skills: "distributed systems, data processing, and big data technologies"
  },
  "Tech Lead": {
    tech: "system design, code review, mentoring, architecture",
    exp: "technical leadership, guiding teams and technical decisions",
    skills: "technical leadership, architecture, and team mentoring"
  },
  "Engineering Manager": {
    tech: "team management, Agile, technical strategy, hiring",
    exp: "engineering management, leading engineering teams",
    skills: "people management, technical strategy, and delivery"
  },
  "CTO": {
    tech: "technology strategy, architecture, team building, innovation",
    exp: "technology leadership, driving technical vision and strategy",
    skills: "strategic planning, technical vision, and executive leadership"
  },
  "Head of Engineering": {
    tech: "engineering strategy, team scaling, process optimization",
    exp: "engineering leadership, building and scaling engineering organizations",
    skills: "organizational design, technical strategy, and leadership"
  },
  "Team Lead": {
    tech: "team coordination, code review, mentoring, Agile",
    exp: "team leadership, coordinating development teams",
    skills: "team coordination, mentoring, and technical guidance"
  },
  "Intern": {
    tech: "programming fundamentals, learning technologies, collaboration",
    exp: "software development internship, learning and contributing to projects",
    skills: "programming, problem-solving, and eagerness to learn"
  },
  "Software Intern": {
    tech: "programming languages, version control, development tools",
    exp: "software development internship, gaining hands-on experience",
    skills: "coding, collaboration, and continuous learning"
  },
  "Freelance Developer": {
    tech: "full-stack development, client communication, project management",
    exp: "freelance development, delivering projects independently",
    skills: "full-stack development, client management, and self-motivation"
  },
  "Consultant": {
    tech: "technical consulting, solution design, stakeholder management",
    exp: "technical consulting, advising organizations on technology",
    skills: "consulting, problem-solving, and communication"
  },
  "Mentor": {
    tech: "mentoring, teaching, career guidance, technical coaching",
    exp: "mentoring, guiding developers in their career growth",
    skills: "teaching, communication, and career development"
  },
  "Trainer": {
    tech: "training, curriculum development, technical education",
    exp: "technical training, educating teams on technologies",
    skills: "training delivery, curriculum design, and knowledge transfer"
  }
};

const ROLE_NAMES = Object.keys(ROLE_TEMPLATES);

function generateTemplate(roleName) {
  const config = ROLE_TEMPLATES[roleName];
  if (!config) {
    return `Hi [Recruiter Name],

I hope you're doing well. I'm [MY NAME].

I have experience in ${roleName.toLowerCase()} roles, working with industry-standard technologies. I've contributed to projects that delivered impactful results.

I'm actively looking for [Role] opportunities at [Company Name] and would truly appreciate a referral if there are any suitable openings. I've attached my resume for your reference.

Best regards,
[MY NAME]`;
  }

  return `Hi [Recruiter Name],

I hope you're doing well. I'm [MY NAME].

I have experience in ${config.exp}. I've worked with ${config.tech}, delivering high-quality solutions and contributing to team success.

I'm proficient in ${config.skills}. My projects demonstrate strong problem-solving abilities and attention to detail.

I'm actively looking for [Role] opportunities at [Company Name] and would truly appreciate a referral if there are any suitable openings. I've attached my resume for your reference.

Best regards,
[MY NAME]`;
}

async function createRoles() {
  console.log("Step 1: Creating roles...");
  const response = await fetch(`${BASE_URL}/roles/create-role`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": AUTH_TOKEN },
    body: JSON.stringify(ROLE_NAMES)
  });
  const data = await response.json();
  if (!data.success) throw new Error("Failed to create roles: " + JSON.stringify(data));
  console.log(`✅ Created ${data.data.length} roles!\n`);
  return data.data;
}

async function createTemplates(roles) {
  console.log("Step 2: Creating role-specific templates...\n");
  const templates = roles.map(role => ({
    name: "Referral Request Message (Default)",
    description: `Professional referral message for ${role.name} positions.`,
    type: "MESSAGE",
    content: generateTemplate(role.name),
    role: role.id,
    rules: ["[Recruiter Name]", "[Company Name]"],
    isCommon: true
  }));

  console.log("  Uploading to database...");
  const batchSize = 10;
  for (let i = 0; i < templates.length; i += batchSize) {
    const batch = templates.slice(i, i + batchSize);
    const response = await fetch(`${BASE_URL}/templates/add-template-bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": AUTH_TOKEN },
      body: JSON.stringify(batch)
    });
    const data = await response.json();
    if (!data.success) throw new Error("Failed batch: " + JSON.stringify(data));
    console.log(`  ✅ Batch ${Math.floor(i/batchSize)+1}/${Math.ceil(templates.length/batchSize)}`);
  }
  console.log(`\n✅ Created ${templates.length} templates!`);
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════╗");
  console.log("║  SEED ROLES & TEMPLATES (Role-Specific Tech)   ║");
  console.log("╚════════════════════════════════════════════════╝\n");

  try {
    const roles = await createRoles();
    await createTemplates(roles);
    console.log("\n✅ SEEDING COMPLETE!\n");
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
}

main();
