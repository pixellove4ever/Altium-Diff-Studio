# Performance

Le benchmark synthétique sert à détecter les régressions importantes du moteur
PCB sans dépendre d’un projet Altium confidentiel.

## Exécution

```bash
npm run test:performance
```

Le scénario génère trois paires de PCB :

|  Taille | Contenu                                         |
| ------: | ----------------------------------------------- |
|  10 000 | pistes réparties sur deux couches + 1 000 pads  |
|  50 000 | pistes réparties sur deux couches + 5 000 pads  |
| 100 000 | pistes réparties sur deux couches + 10 000 pads |

Une largeur de piste est modifiée tous les 997 objets dans la version B. Le banc
mesure :

- le bundle de différences PCB complet ;
- le calcul et le cache des limites géométriques ;
- la construction de l’index spatial ;
- 1 000 séries de requêtes sur les pistes et pads.

## Baseline indicative

Mesure locale du 3 juillet 2026 :

|  Pistes |     Diff | Limites | Index spatial | 1 000 requêtes |
| ------: | -------: | ------: | ------------: | -------------: |
|  10 000 |  52,9 ms |  2,2 ms |        1,4 ms |         0,9 ms |
|  50 000 | 191,4 ms |  5,8 ms |        4,8 ms |         2,2 ms |
| 100 000 | 373,0 ms |  2,2 ms |       13,1 ms |         3,0 ms |

Ces valeurs ne sont pas des objectifs absolus : elles varient selon la machine,
la version de Node et la charge du système. Les seuils automatisés sont donc
volontairement plus larges. Ils doivent détecter un changement d’ordre de
grandeur, pas une variation de quelques millisecondes.

## Seuils de régression

|  Pistes | Diff maximal | Construction de l’index maximale |
| ------: | -----------: | -------------------------------: |
|  10 000 |     1 500 ms |                         1 000 ms |
|  50 000 |     4 000 ms |                         2 500 ms |
| 100 000 |     8 000 ms |                         5 000 ms |

Les 1 000 séries de requêtes doivent rester sous 1 500 ms pour chaque taille.

## Ce que ce benchmark ne mesure pas

- le coût du Canvas 2D et du GPU ;
- le parsing et le transfert d’un fichier JSON ;
- la fidélité des données issues d’Altium ;
- les performances d’un DXF complexe ;
- la consommation mémoire maximale.

Ces points nécessitent un jeu de régression réel et un profilage dans
l’application Electron. Dans les outils avancés de la vue PCB, activer
**Profile PCB rendering**, remettre les mesures à zéro, puis exécuter séparément
les scénarios zoom, pan, survol, sélection de net et slider. Le panneau affiche
séparément le dessin Canvas et le hit-test de survol, avec moyenne, maximum,
dernière mesure et nombre d’échantillons.
