using System.Collections.Concurrent;
using System.Numerics.Tensors;
using System.Security.Cryptography;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using Microsoft.ML.Tokenizers;
using Penny.Backend.Application.Abstractions.Search;

namespace Penny.Backend.Persistence.Search;

// intfloat/multilingual-e5-small (MIT, 384 dimensions) on the CPU through ONNX Runtime
// (MAZ-121). The files come from one pinned Hugging Face revision and must match their
// SHA-256 (apps/backend/development/download-model.mjs fetches them); loading fails
// otherwise. Text is tokenized by Microsoft.ML.Tokenizers with the model's own
// SentencePiece file, run through the model, mean-pooled over the attention mask and
// L2-normalized (the model card's pooling). Nothing leaves the process.
public sealed class OnnxTextEmbedder : ITextEmbedder, IDisposable
{
    public const string Repository = "intfloat/multilingual-e5-small";
    public const string Revision = "614241f622f53c4eeff9890bdc4f31cfecc418b3";
    public const string ModelFile = "model.onnx";
    public const string ModelSha256 =
        "ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665";
    public const string TokenizerFile = "sentencepiece.bpe.model";
    public const string TokenizerSha256 =
        "cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865";

    // Stored with every embedding; a different value makes `search-rebuild` re-embed.
    public const string Id = Repository + "@" + Revision + "/onnx/" + ModelFile;

    private const int MaxTokens = 512;
    private const int BatchSize = 16;
    private const int HiddenSize = 384;

    // The model's vocabulary is the fairseq XLM-R layout: <s>=0, <pad>=1, </s>=2,
    // <unk>=3, then SentencePiece piece n at n+1 (SentencePiece's own <unk> is 0).
    private const long Start = 0;
    private const long Padding = 1;
    private const long End = 2;
    private const long Unknown = 3;
    private const long Offset = 1;

    private static readonly ConcurrentDictionary<string, Lazy<OnnxTextEmbedder>> Loaded = new(
        StringComparer.Ordinal
    );

    private readonly InferenceSession session;
    private readonly SentencePieceTokenizer tokenizer;

    private OnnxTextEmbedder(InferenceSession session, SentencePieceTokenizer tokenizer)
    {
        this.session = session;
        this.tokenizer = tokenizer;
    }

    public string ModelId => Id;

    public int Dimensions => HiddenSize;

    // Loads (once per process and directory) and verifies the pinned files.
    public static OnnxTextEmbedder Load(string? directory)
    {
        if (string.IsNullOrWhiteSpace(directory) || !Path.IsPathFullyQualified(directory))
            throw new InvalidOperationException(
                "Set Search__ModelDirectory to the absolute directory holding the search model (node apps/backend/development/download-model.mjs)."
            );
        var full = Path.GetFullPath(directory);
        try
        {
            return Loaded
                .GetOrAdd(
                    full,
                    path => new Lazy<OnnxTextEmbedder>(
                        () => Create(path),
                        LazyThreadSafetyMode.ExecutionAndPublication
                    )
                )
                .Value;
        }
        catch (InvalidOperationException)
        {
            Loaded.TryRemove(full, out _);
            throw;
        }
    }

    public float[] EmbedQuery(string query) => Embed(["query: " + query])[0];

    public IReadOnlyList<float[]> EmbedPassages(IReadOnlyList<string> passages)
    {
        var vectors = new List<float[]>(passages.Count);
        for (var start = 0; start < passages.Count; start += BatchSize)
            vectors.AddRange(
                Embed([
                    .. passages
                        .Skip(start)
                        .Take(BatchSize)
                        .Select(passage => "passage: " + passage),
                ])
            );
        return vectors;
    }

    public void Dispose() => session.Dispose();

    private static OnnxTextEmbedder Create(string directory)
    {
        var model = Path.Combine(directory, ModelFile);
        var vocabulary = Path.Combine(directory, TokenizerFile);
        Verify(model, ModelSha256);
        Verify(vocabulary, TokenizerSha256);
        using var options = new SessionOptions
        {
            GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL,
        };
        var session = new InferenceSession(model, options);
        using var stream = File.OpenRead(vocabulary);
        return new(
            session,
            SentencePieceTokenizer.Create(
                stream,
                addBeginningOfSentence: false,
                addEndOfSentence: false
            )
        );
    }

    private static void Verify(string path, string expected)
    {
        if (!File.Exists(path))
            throw new InvalidOperationException(
                $"Search model file {Path.GetFileName(path)} is missing from Search__ModelDirectory. Run node apps/backend/development/download-model.mjs."
            );
        using var stream = File.OpenRead(path);
        var actual = Convert.ToHexStringLower(SHA256.HashData(stream));
        if (!string.Equals(actual, expected, StringComparison.Ordinal))
            throw new InvalidOperationException(
                $"Search model file {Path.GetFileName(path)} does not match its pinned SHA-256. Run node apps/backend/development/download-model.mjs."
            );
    }

    private float[][] Embed(IReadOnlyList<string> texts)
    {
        var tokens = texts.Select(Tokens).ToList();
        var width = tokens.Max(ids => ids.Count);
        var count = tokens.Count;
        var inputIds = new long[count * width];
        var mask = new long[count * width];
        Array.Fill(inputIds, Padding);
        for (var row = 0; row < count; row++)
        for (var column = 0; column < tokens[row].Count; column++)
        {
            inputIds[(row * width) + column] = tokens[row][column];
            mask[(row * width) + column] = 1;
        }
        int[] shape = [count, width];
        using var results = session.Run([
            NamedOnnxValue.CreateFromTensor("input_ids", new DenseTensor<long>(inputIds, shape)),
            NamedOnnxValue.CreateFromTensor("attention_mask", new DenseTensor<long>(mask, shape)),
            NamedOnnxValue.CreateFromTensor(
                "token_type_ids",
                new DenseTensor<long>(new long[count * width], shape)
            ),
        ]);
        var hidden = results[0].AsTensor<float>().ToArray();
        var vectors = new float[count][];
        for (var row = 0; row < count; row++)
        {
            var vector = new float[HiddenSize];
            var length = tokens[row].Count;
            for (var column = 0; column < length; column++)
                TensorPrimitives.Add(
                    vector,
                    hidden.AsSpan(((row * width) + column) * HiddenSize, HiddenSize),
                    vector
                );
            TensorPrimitives.Divide(vector, length, vector);
            TensorPrimitives.Divide(vector, TensorPrimitives.Norm(vector), vector);
            vectors[row] = vector;
        }
        return vectors;
    }

    private List<long> Tokens(string text)
    {
        var ids = new List<long>(MaxTokens) { Start };
        foreach (var id in tokenizer.EncodeToIds(text).Take(MaxTokens - 2))
            ids.Add(id == 0 ? Unknown : id + Offset);
        ids.Add(End);
        return ids;
    }
}
