# @leadlandlord/us-cities

Provides a filtered, sampled list of US incorporated places for niche-hunter brainstorm prompts. Pre-filtering to a population band keeps Claude away from well-known metros and surfaces the small towns we actually want for rank-and-rent.

## Source

SimpleMaps US Cities Basic v1.93
https://simplemaps.com/data/us-cities

License: CC BY 4.0

**Attribution:** City data: SimpleMaps US Cities Basic v1.93 (CC BY 4.0).

## Usage

```ts
import { listCities } from '@leadlandlord/us-cities/loader';

const cities = listCities({
  populationMin: 10_000,
  populationMax: 100_000,
  states: ['TX', 'FL'],
  sampleN: 150,
});
```

## API

### `listCities(opts?)`

| Option | Default | Description |
|---|---|---|
| `populationMin` | `10_000` | Minimum city population (inclusive) |
| `populationMax` | `100_000` | Maximum city population (inclusive) |
| `states` | all | Array of 2-letter state codes to restrict to |
| `sampleN` | (all) | Uniform random sample size without replacement |

Only incorporated places (`incorporated === 'TRUE'` in source) are returned.

The CSV is parsed once at module load and memoized.
