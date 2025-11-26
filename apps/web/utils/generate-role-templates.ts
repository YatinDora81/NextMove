import { randomUUID } from 'crypto';

const roles = [
  {
    "id": "28193f71-f281-4b7a-89e2-33cdbc517eed",
    "name": "Full Stack Developer"
  },
  {
    "id": "94a17601-50e6-456d-8cb1-00b3236c7c3c",
    "name": "Frontend Developer"
  },
  {
    "id": "683da169-f342-4f08-aa96-6c85b17bed95",
    "name": "Backend Developer"
  },
  {
    "id": "f1225c75-7b13-4385-afcc-50ea0d92e0c3",
    "name": "Web Developer"
  },
  {
    "id": "4becf1d0-ed06-4326-9276-7f0ad64ac44d",
    "name": "Software Engineer"
  },
  {
    "id": "fa62e101-758d-4bc4-9b90-b886864975c2",
    "name": "React Developer"
  },
  {
    "id": "f967a1cc-33c8-45f3-8819-27b6c11765f8",
    "name": "Next.js Developer"
  },
  {
    "id": "b7c03054-f8ce-4cae-883b-5cad36b7a6bf",
    "name": "Vue.js Developer"
  },
  {
    "id": "1619d06f-70eb-40fc-88c9-ecfadac69777",
    "name": "Angular Developer"
  },
  {
    "id": "20ee77f5-b218-4b8e-a3c1-de83569ed11c",
    "name": "Node.js Developer"
  },
  {
    "id": "6adab6f1-9e85-433e-a2c8-072277ef8d0c",
    "name": "TypeScript Developer"
  },
  {
    "id": "0142a82e-9c52-4714-a69f-8acb18b560cc",
    "name": "JavaScript Developer"
  },
  {
    "id": "47e2b713-fe76-4565-adf6-d17b1ada81d8",
    "name": "Python Developer"
  },
  {
    "id": "3731c4c0-e3f5-438d-9b13-1da01f82603d",
    "name": "Java Developer"
  },
  {
    "id": "d1574b99-eb4a-4bb2-b7d6-52e43f2a3737",
    "name": "Go Developer"
  },
  {
    "id": "4082cfc6-9118-4424-9e03-71f72efa6b27",
    "name": "C++ Developer"
  },
  {
    "id": "22290867-b8f7-499f-a491-20d27838c700",
    "name": "C# Developer"
  },
  {
    "id": "d6013030-5ce7-4c91-98c1-1a7810a396e4",
    "name": "PHP Developer"
  },
  {
    "id": "88588c3e-8448-49b6-8dcb-bf9735434e68",
    "name": "Ruby on Rails Developer"
  },
  {
    "id": "d62ab8bf-b818-4c14-82ee-f533efbe71e7",
    "name": "Django Developer"
  },
  {
    "id": "a5bb73ce-2549-4e5d-ab4c-b69e7c4d2389",
    "name": "Spring Boot Developer"
  },
  {
    "id": "d5dcde50-5318-4390-94e7-449d2dc218ef",
    "name": "NestJS Developer"
  },
  {
    "id": "0c846177-f4a4-42ac-8770-e7c9246a64ed",
    "name": "Express.js Developer"
  },
  {
    "id": "5d6ddd29-8b3c-4080-9544-274e78c2e752",
    "name": "ASP.NET Developer"
  },
  {
    "id": "8eb81578-bb69-43ae-be57-a85be8d6f6a3",
    "name": "WordPress Developer"
  },
  {
    "id": "885aee18-879b-4a4a-a4fc-692cace03fe4",
    "name": "Shopify Developer"
  },
  {
    "id": "3acc5c21-769a-401f-8df1-7d87a43ef037",
    "name": "Wix Developer"
  },
  {
    "id": "fd508d31-1ca6-4319-a24e-e91387f80b92",
    "name": "Mobile App Developer"
  },
  {
    "id": "9b062797-23d6-45ff-ba78-cd24b34ed01b",
    "name": "React Native Developer"
  },
  {
    "id": "e50de670-3920-4907-8d4f-4d16d79458ba",
    "name": "Flutter Developer"
  },
  {
    "id": "1bdd2745-ce0f-41ce-b3d9-93ccbb7b9df3",
    "name": "iOS Developer"
  },
  {
    "id": "36287785-caa3-4f60-812b-c8092ff81a09",
    "name": "Android Developer"
  },
  {
    "id": "9acd97d8-1a57-443f-82ba-8d7e38b822fd",
    "name": "Kotlin Developer"
  },
  {
    "id": "953f6565-8fa2-480d-b671-4302e6c64adb",
    "name": "Swift Developer"
  },
  {
    "id": "17a3fc47-eed8-4e98-8125-954459208271",
    "name": "DevOps Engineer"
  },
  {
    "id": "4b56f988-18eb-40ed-953c-e5515b902734",
    "name": "Cloud Engineer"
  },
  {
    "id": "1010e42d-ff7d-47b7-a956-ea9f089815ae",
    "name": "AWS Engineer"
  },
  {
    "id": "4a747e82-62f5-40e4-9bda-25c29cffa9c2",
    "name": "Azure Engineer"
  },
  {
    "id": "99b97301-29dc-4a84-aa19-95ee46c1f52a",
    "name": "GCP Engineer"
  },
  {
    "id": "1e0d2a7b-7e6b-45ef-b538-8c8b4073d01b",
    "name": "Cloud Architect"
  },
  {
    "id": "55b4be53-926b-4c9d-a390-0713542ad754",
    "name": "Solutions Architect"
  },
  {
    "id": "f3ba6786-5811-417f-8301-a2303ab33b16",
    "name": "Site Reliability Engineer (SRE)"
  },
  {
    "id": "31bebc79-81c8-49b9-8c55-55ada22bdde3",
    "name": "Infrastructure Engineer"
  },
  {
    "id": "8857aad3-381d-40a3-927e-48a8c2acc649",
    "name": "Platform Engineer"
  },
  {
    "id": "9f1089f5-95b0-4621-99ef-23f635705e2d",
    "name": "CI/CD Engineer"
  },
  {
    "id": "5a7b8f35-32b6-48d6-a4cf-0a29abd69834",
    "name": "Data Scientist"
  },
  {
    "id": "48756cce-ece2-41d1-bbae-c02e26064bc8",
    "name": "Data Engineer"
  },
  {
    "id": "0fbb5e40-bb06-4b2f-a45c-2cbf514aa2ad",
    "name": "Machine Learning Engineer"
  },
  {
    "id": "5f1f9f6b-5202-4d90-bb02-735998a2c537",
    "name": "AI Engineer"
  },
  {
    "id": "59746dae-9927-4ab9-9e3f-b6a58e30d794",
    "name": "Deep Learning Engineer"
  },
  {
    "id": "3c647e5d-bc82-4e6b-bb7d-e772103cfc5e",
    "name": "Computer Vision Engineer"
  },
  {
    "id": "a3db27ce-0960-4b28-815d-0633ff153a74",
    "name": "NLP Engineer"
  },
  {
    "id": "39f52814-822d-4fe0-838d-21bdba29cc3f",
    "name": "Data Analyst"
  },
  {
    "id": "cca2d4c3-cc3d-4e08-87b4-e9aa78be032e",
    "name": "Business Intelligence Engineer"
  },
  {
    "id": "0ec85cb0-ca0d-4b52-a0eb-df7ef2e0158a",
    "name": "AI Researcher"
  },
  {
    "id": "5e2e5bdd-ebaa-40fe-8d17-09216413686c",
    "name": "Research Engineer"
  },
  {
    "id": "7d153a54-8027-474c-8b5a-df9b5227cb8e",
    "name": "Prompt Engineer"
  },
  {
    "id": "ab3c83c6-f267-4717-9041-dedd115f2bf3",
    "name": "Cybersecurity Engineer"
  },
  {
    "id": "650b4b94-59ac-44ee-8bc3-c0d8991d307b",
    "name": "Security Analyst"
  },
  {
    "id": "00bbafb8-c5f9-4f9d-84b8-95937ae4beb8",
    "name": "Security Engineer"
  },
  {
    "id": "f8ec02aa-4299-44a7-88dd-b5489138ce85",
    "name": "Penetration Tester"
  },
  {
    "id": "2100c0b6-8132-478f-b0a1-cf8026f1195c",
    "name": "Ethical Hacker"
  },
  {
    "id": "22abca3f-0763-4243-b728-22aba192ca79",
    "name": "Application Security Engineer"
  },
  {
    "id": "c3d08223-4c4a-49e5-9dc5-aa2e206f1da9",
    "name": "Network Security Engineer"
  },
  {
    "id": "564988e4-36b5-4f24-9fb9-13e04f388f38",
    "name": "QA Engineer"
  },
  {
    "id": "a67014d1-3ec9-4758-a97f-b19784be8778",
    "name": "Automation Engineer"
  },
  {
    "id": "dfa33037-e1a4-45d7-b834-bdac972fc6ce",
    "name": "SDET (Software Development Engineer in Test)"
  },
  {
    "id": "6a2120fc-1bd7-49ca-90d7-295865877c4d",
    "name": "Manual Tester"
  },
  {
    "id": "64751868-fa21-428f-a9eb-9d86e5bb590c",
    "name": "Performance Tester"
  },
  {
    "id": "763ac699-80e0-43b8-82ae-1b2b732ac27c",
    "name": "Test Architect"
  },
  {
    "id": "61d70fe3-f132-4525-8c1e-b3eba235bf74",
    "name": "UI/UX Designer"
  },
  {
    "id": "56931f91-5b7c-409d-84bb-61db25f14399",
    "name": "Product Designer"
  },
  {
    "id": "f42b4673-fba0-44d0-9f5d-c4a880f3aeba",
    "name": "UI Designer"
  },
  {
    "id": "524bb176-12c7-4762-99ca-926596cf76fa",
    "name": "UX Researcher"
  },
  {
    "id": "01870b50-2c61-4097-9551-6896d5335287",
    "name": "Product Manager"
  },
  {
    "id": "51d54a87-236f-4d19-8da7-d5c1974fafb7",
    "name": "Technical Product Manager"
  },
  {
    "id": "7cab1ac3-0af7-4908-a595-d22946be2a45",
    "name": "Project Manager"
  },
  {
    "id": "15ea16ca-38e1-4bce-a33c-9c99004f3103",
    "name": "Program Manager"
  },
  {
    "id": "b49b2495-7010-4592-8bfd-09b6cae30d94",
    "name": "Scrum Master"
  },
  {
    "id": "792c5a0c-49b0-49df-8006-31f390c169a1",
    "name": "System Architect"
  },
  {
    "id": "9e9f0503-2179-4224-810a-06e9ec785c11",
    "name": "Systems Engineer"
  },
  {
    "id": "1d71c5b3-cf4e-4f05-a62c-415df132a20a",
    "name": "Embedded Systems Engineer"
  },
  {
    "id": "fbddf714-8951-422a-a0d0-c3df1aca82fa",
    "name": "Hardware Engineer"
  },
  {
    "id": "04128029-9177-4ce1-924f-448e5c6e9d83",
    "name": "IoT Engineer"
  },
  {
    "id": "94f6e687-da91-4045-9713-4f2de7c6e2bc",
    "name": "Firmware Developer"
  },
  {
    "id": "b4ddc1ea-31d3-45de-b6bd-6404aefb07d3",
    "name": "Blockchain Developer"
  },
  {
    "id": "35e06d03-5783-4afd-bf73-8371999ca1dc",
    "name": "Smart Contract Developer"
  },
  {
    "id": "bed77014-99d3-4986-8e72-6453490957e3",
    "name": "Rust Developer"
  },
  {
    "id": "3dfb4060-12b8-44a5-ad02-ecb23d2609da",
    "name": "Solidity Developer"
  },
  {
    "id": "d08c4255-1861-42fa-892c-3072c80a949e",
    "name": "Game Developer"
  },
  {
    "id": "1677392f-0dad-4955-836d-bba636ad9696",
    "name": "Unity Developer"
  },
  {
    "id": "2f676175-c015-4697-bc6b-ce56dc66bbd5",
    "name": "Unreal Engine Developer"
  },
  {
    "id": "6380b8ed-3f52-4ad1-9aa0-c2566e0cace7",
    "name": "AR/VR Developer"
  },
  {
    "id": "66bfdae4-1139-4ebb-8564-0868ca649176",
    "name": "3D Developer"
  },
  {
    "id": "045e9a3c-94a4-40f7-b08b-b786eb72623f",
    "name": "Graphics Programmer"
  },
  {
    "id": "492104ae-b671-4d84-aa76-f6b871141522",
    "name": "Database Administrator (DBA)"
  },
  {
    "id": "2d8990c8-d334-48b6-8df1-4de117613d89",
    "name": "Database Engineer"
  },
  {
    "id": "62c95bab-5c3d-4db9-9333-7ecd94aadaaa",
    "name": "ETL Developer"
  },
  {
    "id": "e807118a-6ef2-4301-a6f8-753aadf0a6d4",
    "name": "Big Data Engineer"
  },
  {
    "id": "cb1afd6d-e355-45be-934b-1ec82b652e76",
    "name": "Tech Lead"
  },
  {
    "id": "b5a85383-2eae-4ffe-8dbb-f046851a0e74",
    "name": "Engineering Manager"
  },
  {
    "id": "cdd63554-30ec-4506-bc1f-a6e4b64e6633",
    "name": "CTO"
  },
  {
    "id": "67f4d6ce-ca00-47b6-be48-36989ce72ac2",
    "name": "Head of Engineering"
  },
  {
    "id": "2ccace91-1c5c-4438-8c9d-60a1574682de",
    "name": "Team Lead"
  },
  {
    "id": "4d197435-b6db-4481-9385-e43a3ac93534",
    "name": "Intern"
  },
  {
    "id": "1fd5c34d-a830-4fe5-879a-70fd330f82fc",
    "name": "Software Intern"
  },
  {
    "id": "1e2c4a56-efd9-4e6b-8351-27e1ce9e9b4f",
    "name": "Freelance Developer"
  },
  {
    "id": "30638d17-6382-4ded-a6ae-356f6458425b",
    "name": "Consultant"
  },
  {
    "id": "710b1d32-c86d-4b1d-93d0-ac610bac18e8",
    "name": "Mentor"
  },
  {
    "id": "21783ea5-360e-4893-87bf-90e655926090",
    "name": "Trainer"
  }
];

function getRoleSpecificContent(roleName) {
  const lowerRole = roleName.toLowerCase();
  
  // Frontend roles
  if (lowerRole.includes('frontend') || lowerRole.includes('react') || lowerRole.includes('next.js') || 
      lowerRole.includes('vue') || lowerRole.includes('angular') || lowerRole.includes('ui designer')) {
    return `I have experience in frontend development, building responsive and interactive user interfaces for scalable web applications. At my current company, I contributed to modern web platforms using React.js, Next.js, TypeScript, and Tailwind CSS, ensuring robust and maintainable frontend systems. At my previous company, I focused on frontend optimization and implemented automated test cases with Jest and React Testing Library, significantly enhancing test coverage and overall application reliability.

I'm proficient in frontend development, with expertise in React.js, Next.js, TypeScript, Tailwind CSS, and modern state management solutions like Redux and Zustand. My recent projects include a collaborative drawing platform and a real-time chat app, where I built responsive and interactive user interfaces, optimized performance, and ensured smooth user experiences.`;
  }
  
  // Backend roles
  if (lowerRole.includes('backend') || lowerRole.includes('node.js') || lowerRole.includes('express') || 
      lowerRole.includes('nestjs') || lowerRole.includes('django') || lowerRole.includes('spring boot') ||
      lowerRole.includes('asp.net') || lowerRole.includes('php') || lowerRole.includes('ruby on rails')) {
    return `I have experience in backend development, building scalable and robust server-side applications. At my current company, I contributed to modern backend systems using Node.js, Express.js, TypeScript, and MySQL, ensuring high performance and maintainable APIs. At my previous company, I focused on backend architecture and implemented automated test cases with Jest and Supertest, significantly enhancing test coverage and overall system reliability.

I'm proficient in backend development, with expertise in RESTful API design, database optimization, microservices architecture, and cloud deployment. My recent projects include building scalable APIs for real-time applications and implementing secure authentication systems, where I optimized database queries, improved system performance, and ensured robust error handling.`;
  }
  
  // Full Stack
  if (lowerRole.includes('full stack') || lowerRole.includes('web developer') || lowerRole.includes('software engineer')) {
    return `I have experience in full-stack development, building both frontend and backend for scalable web applications. At my current company, I contributed to modern web platforms using Next.js, Node.js, TypeScript, and MySQL, ensuring robust and maintainable systems. At my previous company, I focused on frontend development and implemented automated test cases with Selenium and Jest, significantly enhancing test coverage and overall platform reliability.

I'm proficient in full-stack development, with expertise in React.js, Next.js, TypeScript, Tailwind CSS, and modern state management solutions like Redux and Zustand. My recent projects include a collaborative drawing platform and a real-time chat app, where I built responsive and interactive user interfaces, optimized performance, and ensured smooth user experiences.`;
  }
  
  // Mobile
  if (lowerRole.includes('mobile') || lowerRole.includes('react native') || lowerRole.includes('flutter') || 
      lowerRole.includes('ios') || lowerRole.includes('android') || lowerRole.includes('kotlin') || lowerRole.includes('swift')) {
    return `I have experience in mobile app development, building cross-platform and native mobile applications. At my current company, I contributed to mobile platforms using React Native, Flutter, and native technologies, ensuring smooth user experiences and optimal performance. At my previous company, I focused on mobile UI/UX and implemented automated test cases with Jest and Detox, significantly enhancing test coverage and overall app reliability.

I'm proficient in mobile development, with expertise in React Native, Flutter, iOS (Swift), Android (Kotlin), and modern mobile architecture patterns. My recent projects include building responsive mobile applications with real-time features, where I optimized app performance, implemented smooth animations, and ensured excellent user experiences across different devices.`;
  }
  
  // DevOps/Cloud
  if (lowerRole.includes('devops') || lowerRole.includes('cloud') || lowerRole.includes('aws') || 
      lowerRole.includes('azure') || lowerRole.includes('gcp') || lowerRole.includes('sre') || 
      lowerRole.includes('infrastructure') || lowerRole.includes('platform') || lowerRole.includes('ci/cd') ||
      lowerRole.includes('architect') || lowerRole.includes('solutions architect')) {
    return `I have experience in DevOps and cloud engineering, building scalable infrastructure and CI/CD pipelines. At my current company, I contributed to cloud infrastructure using AWS, Docker, Kubernetes, and Terraform, ensuring high availability and automated deployments. At my previous company, I focused on infrastructure automation and implemented monitoring solutions with Prometheus and Grafana, significantly enhancing system reliability and observability.

I'm proficient in DevOps practices, with expertise in cloud platforms (AWS, Azure, GCP), containerization, orchestration, infrastructure as code, and CI/CD pipelines. My recent projects include setting up scalable cloud infrastructure and implementing automated deployment pipelines, where I optimized resource utilization, improved system reliability, and ensured seamless deployments.`;
  }
  
  // Data Science/AI/ML
  if (lowerRole.includes('data scientist') || lowerRole.includes('data engineer') || lowerRole.includes('machine learning') ||
      lowerRole.includes('ai engineer') || lowerRole.includes('deep learning') || lowerRole.includes('computer vision') ||
      lowerRole.includes('nlp') || lowerRole.includes('data analyst') || lowerRole.includes('business intelligence') ||
      lowerRole.includes('ai researcher') || lowerRole.includes('research engineer') || lowerRole.includes('prompt engineer')) {
    return `I have experience in data science and AI/ML engineering, building machine learning models and data pipelines. At my current company, I contributed to ML systems using Python, TensorFlow, PyTorch, and cloud platforms, ensuring scalable and accurate models. At my previous company, I focused on data analysis and implemented automated data pipelines with Apache Airflow, significantly enhancing data processing efficiency and model performance.

I'm proficient in data science and AI/ML, with expertise in Python, machine learning frameworks, data processing, statistical analysis, and cloud ML services. My recent projects include building predictive models and implementing real-time data pipelines, where I optimized model performance, improved data quality, and ensured scalable ML infrastructure.`;
  }
  
  // Security
  if (lowerRole.includes('security') || lowerRole.includes('cybersecurity') || lowerRole.includes('penetration') ||
      lowerRole.includes('ethical hacker') || lowerRole.includes('application security') || lowerRole.includes('network security')) {
    return `I have experience in cybersecurity and security engineering, building secure systems and conducting security assessments. At my current company, I contributed to security infrastructure by implementing security best practices, conducting vulnerability assessments, and ensuring compliance with security standards. At my previous company, I focused on application security and implemented automated security testing with OWASP tools, significantly enhancing system security posture.

I'm proficient in cybersecurity, with expertise in penetration testing, vulnerability assessment, secure coding practices, and security architecture. My recent projects include conducting security audits and implementing security controls, where I identified and mitigated security vulnerabilities, improved security monitoring, and ensured robust security practices.`;
  }
  
  // QA/Testing
  if (lowerRole.includes('qa') || lowerRole.includes('automation') || lowerRole.includes('sdet') ||
      lowerRole.includes('tester') || lowerRole.includes('test architect') || lowerRole.includes('performance tester')) {
    return `I have experience in quality assurance and test automation, building comprehensive test suites and ensuring software quality. At my current company, I contributed to test automation frameworks using Selenium, Jest, and Cypress, ensuring high test coverage and reliable releases. At my previous company, I focused on manual testing and implemented automated test cases, significantly enhancing test efficiency and overall product quality.

I'm proficient in QA and test automation, with expertise in test frameworks, API testing, performance testing, and CI/CD integration. My recent projects include building end-to-end test suites and implementing performance testing strategies, where I improved test coverage, reduced regression issues, and ensured high-quality software releases.`;
  }
  
  // Design
  if (lowerRole.includes('designer') || lowerRole.includes('ux researcher')) {
    return `I have experience in UI/UX design, creating user-centered designs and conducting user research. At my current company, I contributed to design systems and user interfaces using Figma, Adobe XD, and design thinking principles, ensuring intuitive and accessible user experiences. At my previous company, I focused on user research and implemented design prototypes, significantly enhancing user satisfaction and product usability.

I'm proficient in UI/UX design, with expertise in design tools, user research, prototyping, and design systems. My recent projects include designing complete user interfaces and conducting usability studies, where I improved user engagement, enhanced accessibility, and ensured cohesive design experiences.`;
  }
  
  // Product/Project Management
  if (lowerRole.includes('product manager') || lowerRole.includes('project manager') || lowerRole.includes('program manager') ||
      lowerRole.includes('scrum master')) {
    return `I have experience in product and project management, leading cross-functional teams and delivering successful products. At my current company, I contributed to product strategy and roadmap planning, ensuring alignment with business goals and user needs. At my previous company, I focused on agile methodologies and implemented efficient project management processes, significantly enhancing team productivity and delivery timelines.

I'm proficient in product and project management, with expertise in agile methodologies, stakeholder management, roadmap planning, and cross-functional collaboration. My recent projects include launching new product features and managing complex technical projects, where I improved team efficiency, enhanced product quality, and ensured successful project deliveries.`;
  }
  
  // Database
  if (lowerRole.includes('database') || lowerRole.includes('dba') || lowerRole.includes('etl') || lowerRole.includes('big data')) {
    return `I have experience in database engineering and data management, building scalable database systems and data pipelines. At my current company, I contributed to database infrastructure using PostgreSQL, MySQL, and MongoDB, ensuring high performance and data integrity. At my previous company, I focused on ETL processes and implemented data pipelines with Apache Airflow, significantly enhancing data processing efficiency and reliability.

I'm proficient in database engineering, with expertise in SQL, NoSQL databases, data modeling, ETL processes, and data warehousing. My recent projects include optimizing database performance and building scalable data pipelines, where I improved query performance, enhanced data quality, and ensured reliable data processing.`;
  }
  
  // Blockchain
  if (lowerRole.includes('blockchain') || lowerRole.includes('smart contract') || lowerRole.includes('solidity') || lowerRole.includes('rust')) {
    return `I have experience in blockchain development, building decentralized applications and smart contracts. At my current company, I contributed to blockchain platforms using Solidity, Rust, and Web3 technologies, ensuring secure and efficient smart contracts. At my previous company, I focused on DeFi protocols and implemented automated testing for smart contracts, significantly enhancing security and reliability.

I'm proficient in blockchain development, with expertise in smart contract development, DeFi protocols, Web3 integration, and blockchain architecture. My recent projects include building decentralized applications and implementing secure smart contracts, where I improved contract security, optimized gas usage, and ensured robust blockchain solutions.`;
  }
  
  // Game Development
  if (lowerRole.includes('game') || lowerRole.includes('unity') || lowerRole.includes('unreal') || 
      lowerRole.includes('ar/vr') || lowerRole.includes('3d') || lowerRole.includes('graphics')) {
    return `I have experience in game development, building interactive games and 3D applications. At my current company, I contributed to game projects using Unity, Unreal Engine, and 3D graphics technologies, ensuring engaging gameplay and optimal performance. At my previous company, I focused on game mechanics and implemented automated testing, significantly enhancing game quality and player experience.

I'm proficient in game development, with expertise in game engines, 3D graphics, physics simulation, and game design patterns. My recent projects include building multiplayer games and implementing AR/VR experiences, where I optimized game performance, enhanced visual quality, and ensured smooth gameplay experiences.`;
  }
  
  // Leadership roles
  if (lowerRole.includes('tech lead') || lowerRole.includes('engineering manager') || lowerRole.includes('cto') ||
      lowerRole.includes('head of engineering') || lowerRole.includes('team lead')) {
    return `I have experience in technical leadership and engineering management, leading teams and driving technical excellence. At my current company, I contributed to technical strategy and team development, ensuring high-quality deliverables and team growth. At my previous company, I focused on architecture decisions and implemented best practices, significantly enhancing code quality and team productivity.

I'm proficient in technical leadership, with expertise in system architecture, team management, technical strategy, and cross-functional collaboration. My recent projects include leading major technical initiatives and building high-performing engineering teams, where I improved system scalability, enhanced team capabilities, and ensured successful project deliveries.`;
  }
  
  // Intern/Freelance/Consultant
  if (lowerRole.includes('intern') || lowerRole.includes('freelance') || lowerRole.includes('consultant') ||
      lowerRole.includes('mentor') || lowerRole.includes('trainer')) {
    return `I have experience in software development and am eager to contribute to innovative projects. I've worked on various projects using modern technologies and best practices, building both frontend and backend components. My recent work includes developing web applications and implementing automated testing, which has enhanced my understanding of software development lifecycle and quality assurance.

I'm proficient in software development, with knowledge of modern frameworks, programming languages, and development tools. My recent projects include building responsive web applications and implementing RESTful APIs, where I've gained hands-on experience in full-stack development, problem-solving, and collaborative development practices.`;
  }
  
  // Default for specific tech roles
  if (lowerRole.includes('typescript') || lowerRole.includes('javascript') || lowerRole.includes('python') ||
      lowerRole.includes('java') || lowerRole.includes('go') || lowerRole.includes('c++') || lowerRole.includes('c#')) {
    return `I have experience in software development using ${roleName}, building scalable and maintainable applications. At my current company, I contributed to software projects using ${roleName} and modern frameworks, ensuring robust and efficient code. At my previous company, I focused on code quality and implemented automated testing, significantly enhancing test coverage and overall system reliability.

I'm proficient in ${roleName} development, with expertise in modern development practices, design patterns, and software architecture. My recent projects include building scalable applications and implementing best practices, where I improved code quality, enhanced system performance, and ensured maintainable solutions.`;
  }
  
  // WordPress/Shopify/Wix
  if (lowerRole.includes('wordpress') || lowerRole.includes('shopify') || lowerRole.includes('wix')) {
    return `I have experience in ${roleName}, building and customizing websites and e-commerce platforms. At my current company, I contributed to ${roleName} projects, creating custom themes, plugins, and integrations, ensuring optimal performance and user experience. At my previous company, I focused on website optimization and implemented custom solutions, significantly enhancing site functionality and conversion rates.

I'm proficient in ${roleName} development, with expertise in theme development, plugin creation, API integrations, and platform customization. My recent projects include building custom e-commerce solutions and implementing third-party integrations, where I improved site performance, enhanced user experience, and ensured scalable solutions.`;
  }
  
  // Embedded/Hardware/IoT/Firmware
  if (lowerRole.includes('embedded') || lowerRole.includes('hardware') || lowerRole.includes('iot') || lowerRole.includes('firmware')) {
    return `I have experience in embedded systems and hardware engineering, building low-level software and IoT solutions. At my current company, I contributed to embedded projects using C/C++, microcontrollers, and IoT platforms, ensuring efficient and reliable systems. At my previous company, I focused on firmware development and implemented real-time systems, significantly enhancing device performance and reliability.

I'm proficient in embedded systems development, with expertise in C/C++, microcontrollers, real-time systems, and IoT protocols. My recent projects include building IoT devices and developing firmware solutions, where I optimized resource usage, improved system reliability, and ensured efficient hardware-software integration.`;
  }
  
  // System Architect/Systems Engineer
  if (lowerRole.includes('system architect') || lowerRole.includes('systems engineer')) {
    return `I have experience in systems architecture and engineering, designing scalable and reliable systems. At my current company, I contributed to system architecture and infrastructure design, ensuring high availability and performance. At my previous company, I focused on system optimization and implemented architectural best practices, significantly enhancing system scalability and reliability.

I'm proficient in systems architecture, with expertise in distributed systems, microservices, system design, and infrastructure planning. My recent projects include designing large-scale systems and implementing architectural improvements, where I improved system performance, enhanced scalability, and ensured robust system architecture.`;
  }
  
  // Default fallback
  return `I have experience in ${roleName}, contributing to various projects and building expertise in this domain. At my current company, I contributed to projects using modern technologies and best practices, ensuring high-quality deliverables. At my previous company, I focused on continuous improvement and implemented efficient processes, significantly enhancing productivity and outcomes.

I'm proficient in ${roleName}, with expertise in relevant technologies and methodologies. My recent projects include building solutions and implementing improvements, where I enhanced performance, improved quality, and ensured successful project deliveries.`;
}

function generateTemplates() {
  return roles.map(role => {
    const roleSpecificContent = getRoleSpecificContent(role.name);
    const templateId = randomUUID();
    const recruiterNameRuleId = randomUUID();
    const companyNameRuleId = randomUUID();
    
    return {
      name: `Referral Request Message - ${role.name} - default`,
      description: `A professional referral message template for reaching out to recruiters, highlighting ${role.name.toLowerCase()} experience and expertise.`,
      type: "MESSAGE",
      content: `Hi [Recruiter Name],

I hope you're doing well. I'm [MY NAME], a final-year B.E. Computer Science student from Chitkara University.

${roleSpecificContent}

I'm actively looking for [Role] opportunities at [Company Name] and would truly appreciate a referral if there are any suitable openings. I've attached my resume for your reference. Please let me know if you'd need any additional information.

Best regards,
[MY NAME]`,
      role: role.id,
      isDeleted: false,
      roleRelation: {
        id: role.id,
        name: role.name,
        desc: null
      },
      rules: [
        {
          id: recruiterNameRuleId,
          rule: "[Recruiter Name]",
          templateId: templateId
        },
        {
          id: companyNameRuleId,
          rule: "[Company Name]",
          templateId: templateId
        }
      ]
    };
  });
}

const templates = generateTemplates();
console.log(JSON.stringify(templates, null, 2));

