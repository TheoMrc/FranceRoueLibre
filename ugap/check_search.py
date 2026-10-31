import sys
sys.path.insert(0, "ugap")
from common import Polite
c = Polite(min_delay=0.5)
for u in ["https://www.ldlc.com/recherche/6444B001/", "https://www.ldlc.com/fr-fr/recherche/6444B001/",
          "https://www.boulanger.com/resultats?tr=6444B001", "https://www.bureau-vallee.fr/catalogsearch/result/?q=6444B001",
          "https://www.bureau-vallee.fr/recherche?q=6444B001", "https://www.materiel.net/recherche/6444B001/",
          "https://www.rueducommerce.fr/r/6444B001.html", "https://www.ledenicheur.fr/search?search=6444B001",
          "https://www.cdiscount.com/search/10/6444b001.html", "https://www.amazon.fr/s?k=6444B001"]:
    print(c.allowed(u), u)
