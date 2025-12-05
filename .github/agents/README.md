# Custom Agents

This directory contains custom agent configurations for GitHub Copilot. These agents are specialized experts that can help with specific aspects of the project.

## Available Agents

### Cloud Agent (`cloud.yml`)

**Purpose**: Expert in Firebase cloud services, Google Cloud Platform, and cloud infrastructure.

**Use this agent for**:
- Deploying Firebase functions and hosting
- Configuring Firestore security rules
- Setting up Cloud Scheduler jobs
- Troubleshooting cloud deployment issues
- Optimizing cloud function performance
- Managing Firebase project configuration
- Integrating external APIs with cloud functions
- Implementing serverless automation

**Areas of Expertise**:
- Firebase Cloud Functions (Node.js 20)
- Firebase Hosting
- Firestore Database
- Firebase Authentication
- Cloud Scheduler
- Serverless Architecture
- API Integration (FoxESS, Amber, Open-Meteo)
- Cloud Security
- Performance Optimization

**Key Context**:
This agent understands the specific architecture of this solar inverter automation system:
- Multi-user Firebase setup
- Per-user data isolation
- Shared API caching strategy
- FoxESS API signature requirements
- Cost optimization for 100+ users
- Scheduled automation (runs every minute)

## How to Use Custom Agents

When working on tasks related to cloud infrastructure, deployment, or Firebase services, you can delegate to the cloud agent by mentioning it in your conversation with GitHub Copilot:

```
@cloud help me optimize the Cloud Functions deployment
@cloud fix this Firestore security rule
@cloud set up a new Cloud Scheduler job
```

The agent will leverage its specialized knowledge of Firebase and cloud services to provide more accurate and context-aware assistance.

## Adding New Agents

To add a new custom agent:

1. Create a new `.yml` file in this directory
2. Define the agent's name, description, expertise, and context
3. Specify relevant files, tools, and languages
4. Update this README with the new agent's information

## Agent Configuration Format

Each agent configuration file follows this structure:

```yaml
name: agent-name
description: |
  Custom agent: Brief description of the agent's role
  
  Detailed description of specializations
  
expertise:
  - Area 1
  - Area 2

tools:
  - tool1
  - tool2

languages:
  - language1
  - language2

files:
  - path/to/relevant/**/*
  - specific-file.json

context: |
  Additional context about the project or domain
  that helps the agent provide better assistance
```

## Notes

- Custom agents are designed to provide specialized expertise for specific domains
- They have access to the same tools and repository as the main agent
- Using the right agent for the right task improves accuracy and efficiency
- Agents can work together on complex tasks that span multiple domains
