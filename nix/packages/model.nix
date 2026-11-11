# The pinned search embedding model (intfloat/multilingual-e5-small, MIT). Same revision
# and hashes as apps/backend/development/download-model.mjs and `EmbeddingModelFiles`.
{ lib, fetchurl, runCommand }:

let
  repository = "intfloat/multilingual-e5-small";
  revision = "614241f622f53c4eeff9890bdc4f31cfecc418b3";
  fetch = source: hash: fetchurl {
    url = "https://huggingface.co/${repository}/resolve/${revision}/${source}";
    inherit hash;
  };
  model = fetch "onnx/model.onnx" "sha256-ykVsBrOpUF3f2RMUCJFt15KQNoMx59drtiHxy6a8hmU=";
  tokenizer = fetch "onnx/sentencepiece.bpe.model" "sha256-z8gUar4qBIjp4qDFbeeVL3wRqwWeyhRaCnJ6/ODbKGU=";
in
runCommand "penny-search-model-${builtins.substring 0 7 revision}"
  {
    meta = {
      description = "Search embedding model used by the Penny API";
      license = lib.licenses.mit;
    };
  }
  ''
    mkdir -p $out
    ln -s ${model} $out/model.onnx
    ln -s ${tokenizer} $out/sentencepiece.bpe.model
  ''
