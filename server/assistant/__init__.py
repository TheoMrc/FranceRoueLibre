"""AI assistant of francerouelibre.fr: answers readers' questions from the site's open data and from web searches.

Sandboxed by design: the model only gets read-only tools (search index, published JSON files, read-only SQL on the
search index, web search run by the model provider itself). It cannot write a file, run code, reach the local network
or read the configuration. Every model call goes through a hard spending cap (budget.py).
"""
