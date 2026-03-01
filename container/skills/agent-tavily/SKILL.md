---
name: agent-tavily
description: Search the web using Tavily API. Use this tool when you need up-to-date information, facts, news, or research from the web. Tavily provides fast, accurate search results optimized for AI agents.
allowed-tools: Bash
---

# Web Search with Tavily

Tavily is a powerful search API optimized for AI agents. Use it when you need current information, facts, or research from the web.

## When to Use

- When you need up-to-date information or current events
- When you need to verify facts or find sources
- When you need to research a topic
- When the user asks about recent events or news
- When you need specific information from the web

## How to Search

Use the following Bash command to search:

```bash
python3 -c "
from tavily import TavilyClient
import os
import json

api_key = os.environ.get('TAVILY_API_KEY')
if not api_key:
    print('Error: TAVILY_API_KEY not set')
    exit(1)

client = TavilyClient(api_key=api_key)
results = client.search('YOUR SEARCH QUERY HERE', max_results=5)

# Format output nicely
for r in results.get('results', []):
    print(f\"Title: {r.get('title', 'N/A')}\")
    print(f\"URL: {r.get('url', 'N/A')}\")
    print(f\"Content: {r.get('content', 'N/A')[:300]}...\")
    print('---')
"
```

## Example Searches

```bash
# Search for recent news
python3 -c "
from tavily import TavilyClient
import os
import json

client = TavilyClient(api_key=os.environ.get('TAVILY_API_KEY'))
results = client.search('latest AI news 2026', max_results=5)
for r in results.get('results', []):
    print(f\"Title: {r.get('title', 'N/A')}\")
    print(f\"URL: {r.get('url', 'N/A')}\")
    print(f\"Content: {r.get('content', 'N/A')[:200]}...\")
    print('---')
"

# Search for specific information
python3 -c "
from tavily import TavilyClient
import os

client = TavilyClient(api_key=os.environ.get('TAVILY_API_KEY'))
results = client.search('Python fastapi tutorial', max_results=3)
for r in results.get('results', []):
    print(f\"Title: {r.get('title', 'N/A')}\")
    print(f\"URL: {r.get('url', 'N/A')}\")
    print('---')
"

# Get answer directly
python3 -c "
from tavily import TavilyClient
import os

client = TavilyClient(api_key=os.environ.get('TAVILY_API_KEY'))
results = client.search('who is CEO of OpenAI', include_answer=True)
print(results.get('answer', 'No answer found'))
"
```

## Tips

1. **Be specific** with your search query for better results
2. **Use max_results** to control how many results to return (default: 5)
3. **Use include_answer=True** to get a direct answer from Tavily's LLM
4. **Check the sources** - Tavily provides URLs you can visit for more details
