import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'e2e',workers:1,fullyParallel:false,timeout:45000,
  outputDir:'.state/browser-results',
  use:{baseURL:process.env.BARRACKS_BASE_URL??'http://127.0.0.1:4111',channel:'msedge',headless:true,viewport:{width:1440,height:1000},screenshot:'only-on-failure'},
});
