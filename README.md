
Navi_Splat is a 3D spatial exploration platform for inspecting, annotating, and navigating Gaussian Splats so users can explore real-world locations before visiting physically.

Navi_Splat is initially a fork of SuperSplat by PlayCanvas

To learn more about using Navi_Splat, please refer to the [User Guide](https://developer.playcanvas.com/user-manual/gaussian-splatting/editing/Navi_Splat/).

## Local Development

To initialize a local development environment for Navi_Splat, ensure you have [Node.js](https://nodejs.org/) 18 or later installed. Follow these steps:

1. Clone the repository:

   ```sh
   git clone https://github.com/Jindantesparda/Navi_Splat.git
   cd Navi_Splat
   ```

2. Install dependencies:

   ```sh
   npm install
   ```

3. Build Navi_Splat and start a local web server:

   ```sh
   npm run develop
   ```

4. Open a web browser tab and make sure network caching is disabled on the network tab and the other application caches are clear:

   - On Safari you can use `Cmd+Option+e` or Develop->Empty Caches.
   - On Chrome ensure the options "Update on reload" and "Bypass for network" are enabled in the Application->Service workers tab:

5. Navigate to `http://localhost:3000`

When changes to the source are detected, Navi_Splat is rebuilt automatically. Simply refresh your browser to see your changes.

## Localizing the Navi_Splat Editor

The currently supported languages are available here:

https://github.com/playcanvas/Navi_Splat/tree/main/static/locales

### Adding a New Language

1. Add a new `<locale>.json` file in the `static/locales` directory.

2. Add the locale to the list here:

   https://github.com/playcanvas/Navi_Splat/blob/main/src/ui/localization.ts

### Testing Translations

To test your translations:

1. Run the development server:

   ```sh
   npm run develop
   ```

2. Open your browser and navigate to:

   ```
   http://localhost:3000/?lng=<locale>
   ```

   Replace `<locale>` with your language code (e.g., `fr`, `de`, `es`).