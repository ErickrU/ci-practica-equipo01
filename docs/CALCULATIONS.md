# Cálculos, unidades y limitaciones

## Alcance

La aplicación propone el número de barras longitudinales para una columna de concreto armado según los datos proporcionados. Implementa comprobaciones básicas de la NTP E.060 (Perú), concordante con ACI 318, pero no reemplaza un diseño estructural completo ni la revisión de un ingeniero responsable.

## Entradas

| Símbolo | Descripción | Unidad |
|---|---|---|
| `b`, `h` | Dimensiones de una sección rectangular | cm |
| `D` | Diámetro de una sección circular | cm |
| `f'c` | Resistencia especificada a compresión del concreto | kgf/cm² |
| `fy` | Esfuerzo de fluencia del acero | kgf/cm² |
| `ρ` | Cuantía longitudinal seleccionada | % de `Ag` |
| `Pu` | Carga axial última o factorizada | tonf |
| `db` | Diámetro nominal de la barra | cm |
| `r` | Recubrimiento libre hasta el estribo | cm |

La interfaz muestra `kg/cm²` por uso habitual; dimensionalmente corresponde a kgf/cm². La conversión empleada es `1 tonf = 1000 kgf`.

## 1. Área bruta

- Rectangular: `Ag = b × h`
- Circular: `Ag = π × D² / 4`

## 2. Acero requerido

### Método por cuantía

`As,requerido = ρ × Ag`

La aplicación acepta `1 % ≤ ρ ≤ 6 %` (E.060 10.9.1).

### Método por carga axial

Se usa la resistencia máxima de una columna corta sometida a compresión axial pura:

`Pu = α × φ × [0,85 × f'c × (Ag − Ast) + fy × Ast]`

Despejando:

`Ast = [Pu/(αφ) − 0,85 f'c Ag] / [fy − 0,85 f'c]`

Factores usados:

| Sistema transversal | `φ` | `α` | Barras longitudinales mínimas |
|---|---:|---:|---:|
| Estribos | 0,70 | 0,80 | 4 |
| Espiral | 0,75 | 0,85 | 6 |

Si el resultado es inferior a `0,01 Ag`, gobierna la cuantía mínima. Si supera `0,06 Ag`, la aplicación declara insuficiente la sección; no fuerza un armado fuera del límite.

## 3. Número de barras

`n_teórico = techo(As,requerido / Abarra)`

Después se aplica el mínimo de 4 barras para columnas con estribos o 6 para espirales (E.060 10.9.2). En secciones rectangulares, un resultado impar se incrementa en una unidad para mantener la misma cantidad de barras en caras opuestas.

Áreas nominales disponibles:

| Designación | Diámetro (cm) | Área (cm²) |
|---|---:|---:|
| 3/8" | 0,95 | 0,71 |
| 1/2" | 1,27 | 1,29 |
| 5/8" | 1,59 | 2,00 |
| 3/4" | 1,91 | 2,84 |
| 1" | 2,54 | 5,10 |
| 1 3/8" | 3,58 | 10,06 |

El acero realmente colocado es `As,colocado = n × Abarra` y la cuantía resultante es `ρcolocada = As,colocado / Ag`.

## 4. Distribución geométrica

### Rectangular

Las cuatro esquinas siempre contienen una barra. Las restantes se agregan en pares de caras opuestas y se reparten aproximadamente en proporción a `b` y `h`.

La distancia del borde al centro de una barra es:

`margen = recubrimiento + diámetro_estribo + db/2`

La separación libre se calcula independientemente en ambas direcciones. La propuesta cumple cuando las dos son mayores o iguales que `máx(1,5 db, 4 cm)` (E.060 7.6.3).

### Circular

Las barras se ubican a intervalos angulares iguales sobre el radio disponible. La separación libre entre barras adyacentes es la cuerda entre centros menos `db`.

## 5. Estribo automático

- 3/8" para barras longitudinales de hasta 1".
- 1/2" para barras longitudinales mayores de 1".

Corresponde a la comprobación básica de E.060 7.10.5.1. La aplicación no calcula espaciamiento vertical del estribo, ganchos, grapas ni zonas de confinamiento sísmico.

## 6. Observaciones automáticas

Se muestra una observación cuando:

- `ρcolocada > 4 %`: posible congestión en empalmes;
- `ρcolocada > 6 %`: incumplimiento del máximo;
- separación libre menor que `máx(1,5 db, 4 cm)`;
- dimensión menor de 25 cm en una columna sismorresistente;
- recubrimiento menor de 4 cm;
- `f'c < 210 kgf/cm²` en un elemento sismorresistente;
- se usa el método por carga, para recordar que falta verificar interacción P–M.

## 7. Ejemplo reproducible

Para una columna rectangular de `30 × 50 cm`, `ρ = 1 %` y barra de 5/8":

1. `Ag = 30 × 50 = 1500 cm²`
2. `As = 0,01 × 1500 = 15,00 cm²`
3. `n = techo(15 / 2,00) = 8 barras`
4. `As,colocado = 8 × 2,00 = 16,00 cm²`
5. `ρcolocada = 16 / 1500 = 1,07 %`
6. Distribución: 3 barras en cada cara de 30 cm y 3 en cada cara de 50 cm; las cuatro esquinas se comparten.

## 8. Limitaciones de ingeniería

No se calculan momentos, interacción axial-flexión, esbeltez, efectos de segundo orden, irregularidad de sección, disposición en múltiples capas, empalmes, longitud de desarrollo, cortante, requisitos completos del capítulo sísmico ni combinaciones de carga. Una alternativa marcada como “cumple” solo satisface las comprobaciones implementadas.
