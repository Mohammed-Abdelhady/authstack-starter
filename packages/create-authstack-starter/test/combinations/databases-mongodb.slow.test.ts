import { DEFAULT_SELECTION, describeDatabaseProjects, MONGODB_BUDGET } from './database-cases.js';

describeDatabaseProjects('generated MongoDB projects', [
  {
    name: 'MongoDB with the default selection',
    database: 'mongodb',
    features: DEFAULT_SELECTION,
    ...MONGODB_BUDGET,
  },
  {
    name: 'MongoDB with every sign-in method',
    database: 'mongodb',
    features: undefined,
    ...MONGODB_BUDGET,
  },
]);
