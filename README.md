# Local AI chat

A chatbot whose AI model runs entirely in the visitor's browser using
[WebLLM](https://github.com/mlc-ai/web-llm) and WebGPU. No server, no API key, no account.

## Files

```
index.html     page layout
style.css      styling (follows light/dark mode)
js/app.js      model picker, loading, streaming chat
js/worker.js   runs the model in a background thread
js/markdown.js renders the AI's formatted replies safely
```

## Host it on GitHub Pages

1. Create a new repository on GitHub.
2. Upload everything in this folder, keeping the `js` folder, so `index.html` is at the top level.
3. Open **Settings > Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. After a minute your site is live at `https://<username>.github.io/<repo-name>/`.

## Good to know

- **Browser support:** needs WebGPU. Recent Chrome and Edge work best. Phones and older devices may not.
- **First load:** the model downloads from the web (about 0.5 to 4 GB depending on the model) and is cached by the browser. Later visits start much faster.
- **Quality:** these are small models that run on a laptop, so expect them to be less capable than large cloud AI.
- **Pinned version:** `js/app.js` and `js/worker.js` load WebLLM 0.2.79 from the jsDelivr CDN. If you change the version, change it in both files.
- **Change the default model or instructions:** edit `PREFERRED` and `DEFAULT_SYSTEM` at the top of `js/app.js`.
