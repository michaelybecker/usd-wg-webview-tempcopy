#include "pxr/pxr.h"

#include "pxr/base/plug/registry.h"
#include "pxr/base/tf/fileUtils.h"
#include "pxr/base/tf/pathUtils.h"
#include "pxr/base/tf/stringUtils.h"
#include "pxr/base/vt/array.h"
#include "pxr/base/gf/matrix4d.h"
#include "pxr/base/gf/vec2f.h"
#include "pxr/base/gf/vec3f.h"
#include "pxr/base/tf/token.h"
#include "pxr/usd/ar/asset.h"
#include "pxr/usd/ar/definePackageResolver.h"
#include "pxr/usd/ar/packageUtils.h"
#include "pxr/usd/ar/packageResolver.h"
#include "pxr/usd/ar/resolvedPath.h"
#include "pxr/usd/ar/resolver.h"
#include "pxr/usd/sdf/layer.h"
#include "pxr/usd/sdf/fileFormat.h"
#include "pxr/usd/sdf/assetPath.h"
#include "pxr/usd/sdf/primSpec.h"
#include "pxr/usd/sdf/relationshipSpec.h"
#include "pxr/usd/sdf/schema.h"
#include "pxr/usd/sdf/usdzFileFormat.h"
#include "pxr/base/vt/dictionary.h"
#include "pxr/usd/sdf/usdzResolver.h"
#include "pxr/usd/usd/attribute.h"
#include "pxr/usd/usd/editContext.h"
#include "pxr/usd/usd/prim.h"
#include "pxr/usd/usd/primRange.h"
#include "pxr/usd/usd/relationship.h"
#include "pxr/usd/usd/stage.h"
#include "pxr/usd/usd/variantSets.h"
#include "pxr/usd/usdGeom/gprim.h"
#include "pxr/usd/usdGeom/metrics.h"
#include "pxr/usd/usdGeom/mesh.h"
#include "pxr/usd/usdGeom/primvar.h"
#include "pxr/usd/usdGeom/primvarsAPI.h"
#include "pxr/usd/usdGeom/tokens.h"
#include "pxr/usd/usdGeom/xformCache.h"
#include "pxr/usd/usdShade/connectableAPI.h"
#include "pxr/usd/usdShade/input.h"
#include "pxr/usd/usdShade/material.h"
#include "pxr/usd/usdShade/materialBindingAPI.h"
#include "pxr/usd/usdShade/shader.h"
#include "pxr/usd/usdShade/tokens.h"

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <algorithm>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

PXR_NAMESPACE_USING_DIRECTIVE

namespace {

struct MeshPayload
{
    std::vector<float> points;
    std::vector<int> triangleIndices;
    std::vector<float> uvs;
};

int
_CountPrims(const UsdStageRefPtr& stage)
{
    int count = 0;
    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot())) {
        if (!prim.IsPseudoRoot()) {
            ++count;
        }
    }
    return count;
}

std::string
_GetLayerIdentifier(const SdfLayerHandle& layer)
{
    return layer ? layer->GetIdentifier() : std::string();
}

emscripten::val
_ErrorResult(const std::string& path, const std::string& message)
{
    emscripten::val result = emscripten::val::object();
    result.set("rootFile", path);
    result.set("error", message);
    return result;
}

void
InitializeRuntime()
{
    PlugRegistry::GetInstance().RegisterPlugins("/usd/plugInfo.json");

    const TfType resolverType = TfType::FindByName("Sdf_UsdzResolver");
    if (resolverType.IsUnknown() ||
        !resolverType.GetFactory<Ar_PackageResolverFactoryBase>()) {
        Ar_DefinePackageResolver<Sdf_UsdzResolver, ArPackageResolver>();
    }

    if (!SdfFileFormat::FindById(TfToken("usdz"))) {
        SdfDefineFileFormat<SdfUsdzFileFormat, SdfFileFormat>();
    }
}

emscripten::val
_FloatArray(const std::vector<float>& values)
{
    emscripten::val array = emscripten::val::array();
    for (size_t i = 0; i < values.size(); ++i) {
        array.set(i, values[i]);
    }
    return array;
}

emscripten::val
_IntArray(const std::vector<int>& values)
{
    emscripten::val array = emscripten::val::array();
    for (size_t i = 0; i < values.size(); ++i) {
        array.set(i, values[i]);
    }
    return array;
}

emscripten::val
_MatrixArray(const GfMatrix4d& matrix)
{
    emscripten::val array = emscripten::val::array();
    size_t index = 0;
    for (size_t row = 0; row < 4; ++row) {
        for (size_t column = 0; column < 4; ++column) {
            array.set(index++, matrix[row][column]);
        }
    }
    return array;
}

bool
_RelationshipNameLooksLikeMaterialBinding(const TfToken& name)
{
    return TfStringStartsWith(name.GetString(), "material:binding");
}

// Reads raw relationship targets directly from SDF layers, bypassing USD's
// composed relationship API. Necessary for older USDZ files where the
// material:binding relationship was authored without an applied API schema,
// which causes GetTargets()/GetForwardedTargets() to return empty in USD 26+.
SdfPathVector
_GetRelationshipTargetsFromLayers(const UsdPrim& prim, const TfToken& relName)
{
    const SdfPath relPath = prim.GetPath().AppendProperty(relName);

    auto tryLayer = [&](const SdfLayerHandle& layer) -> SdfPathVector {
        if (!layer) return {};
        SdfRelationshipSpecHandle relSpec = TfDynamic_cast<SdfRelationshipSpecHandle>(
            layer->GetObjectAtPath(relPath));
        if (!relSpec) return {};
        const SdfTargetsProxy& proxy = relSpec->GetTargetPathList();
        for (const SdfPath& path : proxy.GetExplicitItems())   { return { path }; }
        for (const SdfPath& path : proxy.GetPrependedItems())  { return { path }; }
        for (const SdfPath& path : proxy.GetAppendedItems())   { return { path }; }
        for (const SdfPath& path : proxy.GetAddedItems())      { return { path }; }
        return {};
    };

    // Try every layer the stage knows about
    for (const SdfLayerHandle& layer : prim.GetStage()->GetUsedLayers(true)) {
        SdfPathVector result = tryLayer(layer);
        if (!result.empty()) return result;
    }
    return {};
}

// Scan the stage for Material prims under the same root as the binding prim.
// Used as last resort when relationship targets are invisible to the USD API.
UsdPrim
_FindMaterialPrimByStageTraversal(const UsdPrim& bindingPrim)
{
    UsdStageWeakPtr stage = bindingPrim.GetStage();
    const std::string bindingRoot = bindingPrim.GetPath().GetPrefixes().front().GetString();

    // First pass: prefer materials under the same hierarchy root
    for (const UsdPrim& p : UsdPrimRange(stage->GetPseudoRoot())) {
        if (!p.IsA<UsdShadeMaterial>()) continue;
        if (TfStringStartsWith(p.GetPath().GetString(), bindingRoot)) {
            return p;
        }
    }
    // Second pass: any material prim on the stage
    for (const UsdPrim& p : UsdPrimRange(stage->GetPseudoRoot())) {
        if (p.IsA<UsdShadeMaterial>()) return p;
    }
    return UsdPrim();
}

UsdShadeMaterial
_FindBoundMaterialByAuthoredRelationships(const UsdPrim& prim)
{
    UsdStageWeakPtr stage = prim.GetStage();
    for (UsdPrim bindingPrim = prim; bindingPrim && !bindingPrim.IsPseudoRoot();
         bindingPrim = bindingPrim.GetParent()) {
        for (const UsdRelationship& relationship : bindingPrim.GetRelationships()) {
            if (!_RelationshipNameLooksLikeMaterialBinding(relationship.GetName())) {
                continue;
            }

            SdfPathVector targets;
            if (!relationship.GetForwardedTargets(&targets) || targets.empty()) {
                targets.clear();
                relationship.GetTargets(&targets);
            }
            if (targets.empty()) {
                targets = _GetRelationshipTargetsFromLayers(bindingPrim, relationship.GetName());
            }

            for (const SdfPath& target : targets) {
                const SdfPath materialPath = target.IsPrimPath() ? target : target.GetPrimPath();
                UsdShadeMaterial material(stage->GetPrimAtPath(materialPath));
                if (material) {
                    return material;
                }
            }
        }
    }

    return UsdShadeMaterial();
}

UsdPrim
_FindBoundMaterialPrimByAuthoredRelationships(const UsdPrim& prim)
{
    UsdStageWeakPtr stage = prim.GetStage();
    for (UsdPrim bindingPrim = prim; bindingPrim && !bindingPrim.IsPseudoRoot();
         bindingPrim = bindingPrim.GetParent()) {
        for (const UsdRelationship& relationship : bindingPrim.GetRelationships()) {
            if (!_RelationshipNameLooksLikeMaterialBinding(relationship.GetName())) {
                continue;
            }

            SdfPathVector targets;
            if (!relationship.GetForwardedTargets(&targets) || targets.empty()) {
                targets.clear();
                relationship.GetTargets(&targets);
            }
            if (targets.empty()) {
                targets = _GetRelationshipTargetsFromLayers(bindingPrim, relationship.GetName());
            }

            for (const SdfPath& target : targets) {
                const SdfPath materialPath = target.IsPrimPath() ? target : target.GetPrimPath();
                UsdPrim materialPrim = stage->GetPrimAtPath(materialPath);
                if (materialPrim) {
                    return materialPrim;
                }
            }
        }
    }

    // All relationship APIs failed — scan stage for Material prims.
    // Handles USD 26+ schema changes that make pre-schema material:binding invisible.
    return _FindMaterialPrimByStageTraversal(prim);
}

emscripten::val
_ColorArray(const UsdGeomMesh& mesh)
{
    VtArray<GfVec3f> colors;
    if (!UsdGeomGprim(mesh).GetDisplayColorAttr().Get(&colors) || colors.empty()) {
        colors.push_back(GfVec3f(0.72f, 0.72f, 0.72f));
    }

    emscripten::val array = emscripten::val::array();
    array.set(0, colors[0][0]);
    array.set(1, colors[0][1]);
    array.set(2, colors[0][2]);
    return array;
}

emscripten::val
_Vec3Array(const GfVec3f& value)
{
    emscripten::val array = emscripten::val::array();
    array.set(0, value[0]);
    array.set(1, value[1]);
    array.set(2, value[2]);
    return array;
}

std::string
_GetMimeType(const std::string& path)
{
    // For USDZ package-relative paths like "file.usdz[inner/texture.jpg]"
    // the extension must be read from the inner path, not the outer one.
    std::string effectivePath = path;
    const size_t openBracket = path.rfind('[');
    if (openBracket != std::string::npos) {
        const size_t closeBracket = path.rfind(']');
        if (closeBracket > openBracket) {
            effectivePath = path.substr(openBracket + 1, closeBracket - openBracket - 1);
        }
    }

    const std::string extension = TfStringToLower(TfGetExtension(effectivePath));
    if (extension == "jpg" || extension == "jpeg") {
        return "image/jpeg";
    }
    if (extension == "png") {
        return "image/png";
    }
    if (extension == "webp") {
        return "image/webp";
    }
    if (extension == "ktx2") {
        return "image/ktx2";
    }
    return "application/octet-stream";
}

emscripten::val
_BytesArray(const std::vector<unsigned char>& bytes)
{
    return emscripten::val::global("Uint8Array")
        .new_(emscripten::typed_memory_view(bytes.size(), bytes.data()));
}

emscripten::val
_ReadTextureAsset(const std::string& path, const std::string& packageRootPath)
{
    emscripten::val texture = emscripten::val::object();
    if (path.empty()) {
        return texture;
    }

    ArResolvedPath resolvedPath = ArGetResolver().Resolve(path);
    std::string resolvedAssetPath = path;
    if (resolvedPath.IsEmpty() && !packageRootPath.empty() && !ArIsPackageRelativePath(path)) {
        resolvedAssetPath = ArJoinPackageRelativePath(packageRootPath, path);
        resolvedPath = ArGetResolver().Resolve(resolvedAssetPath);
    }
    if (resolvedPath.IsEmpty() && ArIsPackageRelativePath(path)) {
        resolvedPath = ArResolvedPath(path);
    }
    if (resolvedPath.IsEmpty()) {
        resolvedPath = ArResolvedPath(resolvedAssetPath);
    }

    std::shared_ptr<ArAsset> asset = ArGetResolver().OpenAsset(resolvedPath);
    if (!asset) {
        return texture;
    }

    std::vector<unsigned char> bytes(asset->GetSize());
    if (!bytes.empty() && asset->Read(bytes.data(), bytes.size(), 0) != bytes.size()) {
        return texture;
    }

    texture.set("path", resolvedAssetPath);
    texture.set("mimeType", _GetMimeType(resolvedAssetPath));
    texture.set("data", _BytesArray(bytes));
    return texture;
}

bool
_GetInputFloat(const UsdShadeShader& shader, const TfToken& name, float* value)
{
    UsdShadeInput input = shader.GetInput(name);
    return input && input.Get(value);
}

bool
_GetInputColor(const UsdShadeShader& shader, const TfToken& name, GfVec3f* value)
{
    UsdShadeInput input = shader.GetInput(name);
    return input && input.Get(value);
}

bool
_GetConnectedTexturePath(const UsdShadeShader& shader, const TfToken& name, std::string* path)
{
    UsdShadeInput input = shader.GetInput(name);
    if (!input) {
        return false;
    }

    UsdShadeConnectableAPI source;
    TfToken sourceName;
    UsdShadeAttributeType sourceType;
    if (!input.GetConnectedSource(&source, &sourceName, &sourceType)) {
        return false;
    }

    UsdShadeShader textureShader(source.GetPrim());
    if (!textureShader) {
        return false;
    }

    SdfAssetPath filePath;
    UsdShadeInput fileInput = textureShader.GetInput(TfToken("file"));
    if (!fileInput || !fileInput.Get(&filePath)) {
        return false;
    }

    *path = !filePath.GetResolvedPath().empty()
        ? filePath.GetResolvedPath()
        : filePath.GetAssetPath();
    return !path->empty();
}

UsdPrim
_GetConnectedSourcePrim(const UsdAttribute& attribute)
{
    SdfPathVector connections;
    if (!attribute || !attribute.GetConnections(&connections) || connections.empty()) {
        return UsdPrim();
    }

    return attribute.GetPrim().GetStage()->GetPrimAtPath(connections[0].GetPrimPath());
}

UsdPrim
_FindSurfaceShaderPrim(const UsdPrim& materialPrim)
{
    // Modern USD: outputs:surface is an attribute with a .connect connection
    UsdAttribute surfaceAttr = materialPrim.GetAttribute(TfToken("outputs:surface"));
    SdfPathVector connections;
    if (surfaceAttr && surfaceAttr.GetConnections(&connections) && !connections.empty()) {
        return materialPrim.GetStage()->GetPrimAtPath(connections[0].GetPrimPath());
    }

    // Older USD: outputs:surface is a relationship
    UsdRelationship surfaceRelationship =
        materialPrim.GetRelationship(TfToken("outputs:surface"));
    SdfPathVector targets;
    if (surfaceRelationship &&
        surfaceRelationship.GetForwardedTargets(&targets) &&
        !targets.empty()) {
        return materialPrim.GetStage()->GetPrimAtPath(targets[0].GetPrimPath());
    }

    for (const UsdRelationship& relationship : materialPrim.GetRelationships()) {
        if (!TfStringStartsWith(relationship.GetName().GetString(), "outputs:surface")) {
            continue;
        }

        targets.clear();
        if (relationship.GetForwardedTargets(&targets) && !targets.empty()) {
            return materialPrim.GetStage()->GetPrimAtPath(targets[0].GetPrimPath());
        }
    }

    // Fallback: scan direct children for the surface shader prim.
    // Used when outputs:surface connections are invisible to the USD 26 API
    // (happens with older USDZ files where API schemas weren't applied).
    for (const UsdPrim& child : materialPrim.GetChildren()) {
        TfToken shaderId;
        // Prefer the child that explicitly says it's a surface shader
        if (child.GetAttribute(TfToken("info:id")).Get(&shaderId) &&
            (shaderId == TfToken("UsdPreviewSurface") ||
             shaderId == TfToken("PxrSurface") ||
             TfStringEndsWith(shaderId.GetString(), "Surface"))) {
            return child;
        }
    }
    // Any shader child as last resort
    for (const UsdPrim& child : materialPrim.GetChildren()) {
        if (child.IsA<UsdShadeShader>()) {
            return child;
        }
    }

    return UsdPrim();
}

bool
_GetAuthoredInputFloat(const UsdPrim& prim, const TfToken& name, float* value)
{
    return prim.GetAttribute(TfToken("inputs:" + name.GetString())).Get(value);
}

bool
_GetAuthoredInputColor(const UsdPrim& prim, const TfToken& name, GfVec3f* value)
{
    return prim.GetAttribute(TfToken("inputs:" + name.GetString())).Get(value);
}

bool
_GetAuthoredConnectedTexturePath(const UsdPrim& shaderPrim, const TfToken& name, std::string* path)
{
    UsdPrim texturePrim =
        _GetConnectedSourcePrim(shaderPrim.GetAttribute(TfToken("inputs:" + name.GetString())));
    if (!texturePrim) {
        return false;
    }

    SdfAssetPath filePath;
    if (!texturePrim.GetAttribute(TfToken("inputs:file")).Get(&filePath)) {
        return false;
    }

    *path = !filePath.GetResolvedPath().empty()
        ? filePath.GetResolvedPath()
        : filePath.GetAssetPath();
    return !path->empty();
}

emscripten::val
_TryExtractTexture(
    const UsdShadeShader& shader,
    const UsdPrim& shaderPrim,
    const TfToken& inputName,
    const std::string& packageRootPath)
{
    std::string texturePath;
    if ((shader && _GetConnectedTexturePath(shader, inputName, &texturePath)) ||
        _GetAuthoredConnectedTexturePath(shaderPrim, inputName, &texturePath)) {
        emscripten::val texture = _ReadTextureAsset(texturePath, packageRootPath);
        if (!texture["data"].isUndefined()) {
            return texture;
        }
    }
    return emscripten::val::undefined();
}

// Scans material prim descendants for UsdUVTexture shaders and maps each to a
// texture slot by file-name heuristic. Used as fallback when attribute
// connections are invisible (older USDZ files on USD 26+).
void
_ExtractTexturesFromShaderDescendants(
    const UsdPrim& root,
    const std::string& packageRootPath,
    emscripten::val& materialValue)
{
    for (const UsdPrim& child : UsdPrimRange(root)) {
        if (child == root) continue;

        TfToken shaderId;
        if (!child.GetAttribute(TfToken("info:id")).Get(&shaderId) ||
            shaderId != TfToken("UsdUVTexture")) {
            continue;
        }

        SdfAssetPath filePath;
        if (!child.GetAttribute(TfToken("inputs:file")).Get(&filePath)) {
            continue;
        }

        const std::string rawPath = !filePath.GetResolvedPath().empty()
            ? filePath.GetResolvedPath()
            : filePath.GetAssetPath();
        if (rawPath.empty()) {
            continue;
        }

        emscripten::val texture = _ReadTextureAsset(rawPath, packageRootPath);
        if (texture["data"].isUndefined()) {
            continue;
        }

        const std::string lower = TfStringToLower(rawPath);

        // Color/diffuse detection: match "color", "diffuse", "albedo", "basecolor"
        // or presence of a valid outputs:rgb (color output) attribute
        const bool hasRgbOutput =
            child.GetAttribute(TfToken("outputs:rgb")) &&
            child.GetAttribute(TfToken("outputs:rgb")).IsAuthored();
        const bool nameIsColor =
            lower.find("color") != std::string::npos ||
            lower.find("diffuse") != std::string::npos ||
            lower.find("albedo") != std::string::npos ||
            lower.find("basecolor") != std::string::npos;

        if ((hasRgbOutput || nameIsColor) && materialValue["diffuseTexture"].isUndefined()) {
            materialValue.set("diffuseTexture", texture);
        } else if ((lower.find("clearcoat") != std::string::npos &&
                    lower.find("rough") != std::string::npos) &&
                   materialValue["clearcoatRoughnessTexture"].isUndefined()) {
            materialValue.set("clearcoatRoughnessTexture", texture);
        } else if (lower.find("clearcoat") != std::string::npos &&
                   materialValue["clearcoatTexture"].isUndefined()) {
            materialValue.set("clearcoatTexture", texture);
        } else if ((lower.find("rough") != std::string::npos) &&
                   materialValue["roughnessTexture"].isUndefined()) {
            materialValue.set("roughnessTexture", texture);
        } else if ((lower.find("metal") != std::string::npos) &&
                   materialValue["metallicTexture"].isUndefined()) {
            materialValue.set("metallicTexture", texture);
        } else if ((lower.find("normal") != std::string::npos ||
                    lower.find("nrm") != std::string::npos) &&
                   materialValue["normalTexture"].isUndefined()) {
            materialValue.set("normalTexture", texture);
        } else if ((lower.find("occlusion") != std::string::npos ||
                    lower.find("_ao") != std::string::npos) &&
                   materialValue["occlusionTexture"].isUndefined()) {
            materialValue.set("occlusionTexture", texture);
        } else if ((lower.find("emissive") != std::string::npos ||
                    lower.find("emission") != std::string::npos) &&
                   materialValue["emissiveTexture"].isUndefined()) {
            materialValue.set("emissiveTexture", texture);
        } else if ((lower.find("opacity") != std::string::npos ||
                    lower.find("alpha") != std::string::npos) &&
                   materialValue["opacityTexture"].isUndefined()) {
            materialValue.set("opacityTexture", texture);
        }
    }
}

emscripten::val
_ExtractMaterial(
    const UsdPrim& prim,
    const std::string& packageRootPath,
    UsdShadeMaterialBindingAPI::BindingsCache* bindingsCache,
    UsdShadeMaterialBindingAPI::CollectionQueryCache* collectionQueryCache,
    const emscripten::val& fallbackColor)
{
    emscripten::val materialValue = emscripten::val::object();
    materialValue.set("diffuseColor", fallbackColor);
    materialValue.set("roughness", 0.55f);
    materialValue.set("metallic", 0.05f);
    materialValue.set("opacity", 1.0f);

    UsdShadeMaterial material = UsdShadeMaterialBindingAPI(prim).ComputeBoundMaterial(
        bindingsCache,
        collectionQueryCache);
    if (!material) {
        material = _FindBoundMaterialByAuthoredRelationships(prim);
    }

    UsdPrim materialPrim = material ? material.GetPrim() : UsdPrim();
    if (!materialPrim) {
        materialPrim = _FindBoundMaterialPrimByAuthoredRelationships(prim);
    }
    if (!materialPrim) {
        return materialValue;
    }

    materialValue.set("path", materialPrim.GetPath().GetString());

    TfToken sourceName;
    UsdShadeAttributeType sourceType;
    UsdShadeShader shader;
    if (material) {
        shader = material.ComputeSurfaceSource(
            {UsdShadeTokens->universalRenderContext},
            &sourceName,
            &sourceType);
    }

    UsdPrim shaderPrim = shader ? shader.GetPrim() : _FindSurfaceShaderPrim(materialPrim);
    if (!shaderPrim) {
        return materialValue;
    }

    TfToken shaderId;
    if (shader && shader.GetShaderId(&shaderId)) {
        materialValue.set("shaderId", shaderId.GetString());
    } else if (shaderPrim.GetAttribute(TfToken("info:id")).Get(&shaderId)) {
        materialValue.set("shaderId", shaderId.GetString());
    }

    // Scalar properties
    GfVec3f diffuseColor;
    if ((shader && _GetInputColor(shader, TfToken("diffuseColor"), &diffuseColor)) ||
        _GetAuthoredInputColor(shaderPrim, TfToken("diffuseColor"), &diffuseColor)) {
        materialValue.set("diffuseColor", _Vec3Array(diffuseColor));
    }

    GfVec3f emissiveColor;
    if ((shader && _GetInputColor(shader, TfToken("emissiveColor"), &emissiveColor)) ||
        _GetAuthoredInputColor(shaderPrim, TfToken("emissiveColor"), &emissiveColor)) {
        materialValue.set("emissiveColor", _Vec3Array(emissiveColor));
    }

    float scalar = 0.0f;
    if ((shader && _GetInputFloat(shader, TfToken("roughness"), &scalar)) ||
        _GetAuthoredInputFloat(shaderPrim, TfToken("roughness"), &scalar)) {
        materialValue.set("roughness", scalar);
    }
    if ((shader && _GetInputFloat(shader, TfToken("metallic"), &scalar)) ||
        _GetAuthoredInputFloat(shaderPrim, TfToken("metallic"), &scalar)) {
        materialValue.set("metallic", scalar);
    }
    if ((shader && _GetInputFloat(shader, TfToken("opacity"), &scalar)) ||
        _GetAuthoredInputFloat(shaderPrim, TfToken("opacity"), &scalar)) {
        materialValue.set("opacity", scalar);
    }
    if ((shader && _GetInputFloat(shader, TfToken("clearcoat"), &scalar)) ||
        _GetAuthoredInputFloat(shaderPrim, TfToken("clearcoat"), &scalar)) {
        materialValue.set("clearcoat", scalar);
    }
    if ((shader && _GetInputFloat(shader, TfToken("clearcoatRoughness"), &scalar)) ||
        _GetAuthoredInputFloat(shaderPrim, TfToken("clearcoatRoughness"), &scalar)) {
        materialValue.set("clearcoatRoughness", scalar);
    }
    if ((shader && _GetInputFloat(shader, TfToken("ior"), &scalar)) ||
        _GetAuthoredInputFloat(shaderPrim, TfToken("ior"), &scalar)) {
        materialValue.set("ior", scalar);
    }

    // Texture channels
    static const struct { const char* inputName; const char* resultKey; } kTextureSlots[] = {
        { "diffuseColor",       "diffuseTexture"            },
        { "roughness",          "roughnessTexture"          },
        { "metallic",           "metallicTexture"           },
        { "normal",             "normalTexture"             },
        { "occlusion",          "occlusionTexture"          },
        { "emissiveColor",      "emissiveTexture"           },
        { "clearcoat",          "clearcoatTexture"          },
        { "clearcoatRoughness", "clearcoatRoughnessTexture" },
        { "opacity",            "opacityTexture"            },
    };

    bool foundTexture = false;
    for (const auto& slot : kTextureSlots) {
        emscripten::val texture = _TryExtractTexture(
            shader, shaderPrim, TfToken(slot.inputName), packageRootPath);
        if (!texture.isUndefined()) {
            materialValue.set(slot.resultKey, texture);
            foundTexture = true;
        }
    }

    if (!foundTexture && materialPrim) {
        _ExtractTexturesFromShaderDescendants(materialPrim, packageRootPath, materialValue);
    }

    return materialValue;
}

bool
_GetUvForFaceVertex(
    const VtArray<GfVec2f>& uvValues,
    const TfToken& interpolation,
    size_t faceVertexOffset,
    int pointIndex,
    GfVec2f* uv)
{
    if (interpolation == UsdGeomTokens->faceVarying &&
        faceVertexOffset < uvValues.size()) {
        *uv = uvValues[faceVertexOffset];
        return true;
    }

    if ((interpolation == UsdGeomTokens->vertex || interpolation == UsdGeomTokens->varying) &&
        pointIndex >= 0 &&
        static_cast<size_t>(pointIndex) < uvValues.size()) {
        *uv = uvValues[pointIndex];
        return true;
    }

    if (interpolation == UsdGeomTokens->constant && uvValues.size() == 1) {
        *uv = uvValues[0];
        return true;
    }

    return false;
}

bool
_ExtractMeshPayload(const UsdGeomMesh& mesh, MeshPayload* payload)
{
    VtArray<GfVec3f> usdPoints;
    VtArray<int> faceVertexCounts;
    VtArray<int> faceVertexIndices;

    if (!mesh.GetPointsAttr().Get(&usdPoints) ||
        !mesh.GetFaceVertexCountsAttr().Get(&faceVertexCounts) ||
        !mesh.GetFaceVertexIndicesAttr().Get(&faceVertexIndices) ||
        usdPoints.empty() ||
        faceVertexCounts.empty() ||
        faceVertexIndices.empty()) {
        return false;
    }

    VtArray<GfVec2f> uvValues;
    TfToken uvInterpolation;
    UsdGeomPrimvar stPrimvar = UsdGeomPrimvarsAPI(mesh).GetPrimvar(TfToken("st"));
    const bool hasUvValues =
        stPrimvar &&
        stPrimvar.ComputeFlattened(&uvValues) &&
        !uvValues.empty();

    if (hasUvValues) {
        uvInterpolation = stPrimvar.GetInterpolation();
    }

    payload->points.reserve(faceVertexIndices.size() * 3);
    payload->triangleIndices.reserve(faceVertexIndices.size());
    if (hasUvValues) {
        payload->uvs.reserve(faceVertexIndices.size() * 2);
    }

    auto appendVertex = [&](size_t faceVertexOffset) {
        const int pointIndex = faceVertexIndices[faceVertexOffset];
        const GfVec3f& point = usdPoints[pointIndex];
        payload->points.push_back(point[0]);
        payload->points.push_back(point[1]);
        payload->points.push_back(point[2]);

        GfVec2f uv(0.0f, 0.0f);
        if (hasUvValues &&
            _GetUvForFaceVertex(uvValues, uvInterpolation, faceVertexOffset, pointIndex, &uv)) {
            payload->uvs.push_back(uv[0]);
            payload->uvs.push_back(uv[1]);
        }

        const int vertexIndex = static_cast<int>((payload->points.size() / 3) - 1);
        payload->triangleIndices.push_back(vertexIndex);
    };

    size_t offset = 0;
    for (int faceVertexCount : faceVertexCounts) {
        if (faceVertexCount < 3 ||
            offset + static_cast<size_t>(faceVertexCount) > faceVertexIndices.size()) {
            offset += std::max(faceVertexCount, 0);
            continue;
        }

        for (int i = 1; i < faceVertexCount - 1; ++i) {
            const int firstIndex = faceVertexIndices[offset];
            const int secondIndex = faceVertexIndices[offset + i];
            const int thirdIndex = faceVertexIndices[offset + i + 1];
            if (firstIndex < 0 || secondIndex < 0 || thirdIndex < 0 ||
                static_cast<size_t>(firstIndex) >= usdPoints.size() ||
                static_cast<size_t>(secondIndex) >= usdPoints.size() ||
                static_cast<size_t>(thirdIndex) >= usdPoints.size()) {
                continue;
            }

            appendVertex(offset);
            appendVertex(offset + i);
            appendVertex(offset + i + 1);
        }

        offset += faceVertexCount;
    }

    if (payload->uvs.size() != (payload->points.size() / 3) * 2) {
        payload->uvs.clear();
    }

    return !payload->triangleIndices.empty();
}

// Cache to avoid re-opening the stage on every ExtractTransformsAtTime call.
// Key is the normalized stage path passed by the JS caller.
static std::unordered_map<std::string, UsdStageRefPtr> g_stageCache;

UsdStageRefPtr
_GetOrOpenStage(const std::string& path)
{
    auto it = g_stageCache.find(path);
    if (it != g_stageCache.end()) {
        return it->second;
    }
    UsdStageRefPtr stage = UsdStage::Open(path);
    if (stage) {
        g_stageCache[path] = stage;
    }
    return stage;
}

} // namespace

emscripten::val
GetRuntimeDiagnostics()
{
    emscripten::val result = emscripten::val::object();
    const TfType resolverType = TfType::FindByName("Sdf_UsdzResolver");
    result.set("hasUsdzResolverType", !resolverType.IsUnknown());
    result.set(
        "hasUsdzResolverFactory",
        resolverType.GetFactory<Ar_PackageResolverFactoryBase>() != nullptr);
    result.set("canReadUsdz", SdfFileFormat::FormatSupportsReading("usdz", "usd"));
    result.set("hasUsdzFormat", static_cast<bool>(SdfFileFormat::FindByExtension("file.usdz", "usd")));
    result.set("hasUsdzFormatNoTarget", static_cast<bool>(SdfFileFormat::FindByExtension("file.usdz")));
    result.set("hasUsdzFormatById", static_cast<bool>(SdfFileFormat::FindById(TfToken("usdz"))));
    return result;
}

emscripten::val
InspectPrimRelationships(const std::string& stagePath, const std::string& primPath)
{
    emscripten::val result = emscripten::val::array();
    UsdStageRefPtr stage = UsdStage::Open(stagePath);
    if (!stage) {
        return result;
    }

    UsdPrim prim = stage->GetPrimAtPath(SdfPath(primPath));
    size_t index = 0;
    for (UsdPrim bindingPrim = prim; bindingPrim && !bindingPrim.IsPseudoRoot();
         bindingPrim = bindingPrim.GetParent()) {
        emscripten::val primInfo = emscripten::val::object();
        primInfo.set("path", bindingPrim.GetPath().GetString());
        emscripten::val relationships = emscripten::val::array();

        size_t relationshipIndex = 0;
        for (const UsdRelationship& relationship : bindingPrim.GetRelationships()) {
            emscripten::val relationshipInfo = emscripten::val::object();
            relationshipInfo.set("name", relationship.GetName().GetString());
            relationshipInfo.set(
                "isMaterialBinding",
                _RelationshipNameLooksLikeMaterialBinding(relationship.GetName()));

            SdfPathVector targets;
            if (!relationship.GetForwardedTargets(&targets) || targets.empty()) {
                targets.clear();
                relationship.GetTargets(&targets);
            }
            if (targets.empty()) {
                targets = _GetRelationshipTargetsFromLayers(bindingPrim, relationship.GetName());
            }
            if (!targets.empty()) {
                emscripten::val targetValues = emscripten::val::array();
                for (size_t targetIndex = 0; targetIndex < targets.size(); ++targetIndex) {
                    targetValues.set(targetIndex, targets[targetIndex].GetString());
                }
                relationshipInfo.set("targets", targetValues);
            }

            relationships.set(relationshipIndex++, relationshipInfo);
        }

        primInfo.set("relationships", relationships);
        result.set(index++, primInfo);
    }

    return result;
}

emscripten::val
ExtractRenderables(const std::string& path)
{
    emscripten::val renderables = emscripten::val::array();
    UsdStageRefPtr stage = _GetOrOpenStage(path);
    if (!stage) {
        return renderables;
    }

    UsdGeomXformCache xformCache(stage->GetStartTimeCode());
    UsdShadeMaterialBindingAPI::BindingsCache bindingsCache;
    UsdShadeMaterialBindingAPI::CollectionQueryCache collectionQueryCache;

    // For USDZ files the root layer identifier is a package-relative path like
    // "file.usdz[Root.usdc]". Strip the inner component so we hold just the
    // package path and ArJoinPackageRelativePath produces valid single-level
    // package-relative texture paths ("file.usdz[textures/t.jpg]") instead of
    // the double-nested form "file.usdz[Root.usdc][textures/t.jpg]".
    std::string packageRootPath = _GetLayerIdentifier(stage->GetRootLayer());
    if (ArIsPackageRelativePath(packageRootPath)) {
        const size_t bracketPos = packageRootPath.find('[');
        if (bracketPos != std::string::npos) {
            packageRootPath = packageRootPath.substr(0, bracketPos);
        }
    }
    size_t renderableIndex = 0;

    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot())) {
        if (!prim.IsA<UsdGeomMesh>()) {
            continue;
        }

        UsdGeomMesh mesh(prim);
        MeshPayload payload;
        if (!_ExtractMeshPayload(mesh, &payload)) {
            continue;
        }

        emscripten::val renderable = emscripten::val::object();
        renderable.set("path", prim.GetPath().GetString());
        renderable.set("name", prim.GetName().GetString());
        renderable.set("points", _FloatArray(payload.points));
        renderable.set("indices", _IntArray(payload.triangleIndices));
        if (!payload.uvs.empty()) {
            renderable.set("uvs", _FloatArray(payload.uvs));
        }
        renderable.set("matrix", _MatrixArray(xformCache.GetLocalToWorldTransform(prim)));
        renderable.set("color", _ColorArray(mesh));
        renderable.set(
            "material",
            _ExtractMaterial(
                prim,
                packageRootPath,
                &bindingsCache,
                &collectionQueryCache,
                renderable["color"]));
        renderables.set(renderableIndex++, renderable);
    }

    return renderables;
}

emscripten::val
OpenStage(const std::string& path)
{
    UsdStageRefPtr stage = _GetOrOpenStage(path);
    if (!stage) {
        return _ErrorResult(path, "Unable to open USD stage");
    }

    emscripten::val result = emscripten::val::object();
    result.set("rootFile", path);
    result.set("rootLayerIdentifier", _GetLayerIdentifier(stage->GetRootLayer()));
    result.set("primCount", _CountPrims(stage));
    result.set("layerCount", static_cast<int>(stage->GetUsedLayers().size()));
    result.set("timeCodesPerSecond", stage->GetTimeCodesPerSecond());
    result.set("startTimeCode", stage->GetStartTimeCode());
    result.set("endTimeCode", stage->GetEndTimeCode());
    result.set("upAxis", UsdGeomGetStageUpAxis(stage).GetString());
    return result;
}

emscripten::val
ExtractTransformsAtTime(const std::string& path, double timeCode)
{
    emscripten::val transforms = emscripten::val::array();
    UsdStageRefPtr stage = _GetOrOpenStage(path);
    if (!stage) {
        return transforms;
    }

    UsdGeomXformCache xformCache(timeCode);
    size_t index = 0;

    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot())) {
        if (!prim.IsA<UsdGeomMesh>()) {
            continue;
        }
        emscripten::val entry = emscripten::val::object();
        entry.set("path", prim.GetPath().GetString());
        entry.set("matrix", _MatrixArray(xformCache.GetLocalToWorldTransform(prim)));
        transforms.set(index++, entry);
    }

    return transforms;
}

emscripten::val
GetSceneGraph(const std::string& path)
{
    emscripten::val result = emscripten::val::array();
    UsdStageRefPtr stage = _GetOrOpenStage(path);
    if (!stage) {
        return result;
    }

    // Include prims with unloaded payloads so the scene graph retains
    // their entries (with a ghostly P button) even after unloading.
    // UsdPrimDefaultPredicate also requires UsdPrimIsLoaded which would
    // silently drop them from traversal.
    const auto traversePredicate =
        UsdPrimIsActive && UsdPrimIsDefined && !UsdPrimIsAbstract;

    size_t index = 0;
    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot(), traversePredicate)) {
        if (prim.IsPseudoRoot()) {
            continue;
        }

        // hasChildren should reflect what's visible under current load state
        // (use default predicate children so collapsed payload children are hidden)
        const auto children = prim.GetFilteredChildren(UsdPrimDefaultPredicate);
        emscripten::val item = emscripten::val::object();
        item.set("path", prim.GetPath().GetString());
        item.set("name", prim.GetName().GetString());
        item.set("typeName", prim.GetTypeName().GetString());
        item.set("depth", static_cast<int>(prim.GetPath().GetPathElementCount()) - 1);
        item.set("isActive", prim.IsActive());
        item.set("hasChildren", children.begin() != children.end());
        item.set("hasVariantSets", !prim.GetVariantSets().GetNames().empty());
        item.set("hasPayloads", prim.HasPayload());
        item.set("isPayloadLoaded", prim.IsLoaded());
        result.set(index++, item);
    }

    return result;
}

emscripten::val
GetPrimAttributes(const std::string& stagePath, const std::string& primPath)
{
    emscripten::val result = emscripten::val::array();
    UsdStageRefPtr stage = _GetOrOpenStage(stagePath);
    if (!stage) {
        return result;
    }

    const UsdPrim prim = stage->GetPrimAtPath(SdfPath(primPath));
    if (!prim) {
        return result;
    }

    size_t index = 0;
    for (const UsdAttribute& attr : prim.GetAttributes()) {
        emscripten::val item = emscripten::val::object();
        item.set("name", attr.GetName().GetString());
        item.set("typeName", attr.GetTypeName().GetAsToken().GetString());
        item.set("isAuthored", attr.IsAuthored());

        VtValue value;
        if (attr.Get(&value)) {
            std::string str;
            if (value.IsArrayValued() && value.GetArraySize() > 8) {
                str = "[" + std::to_string(value.GetArraySize()) + " elements]";
            } else {
                std::ostringstream oss;
                oss << value;
                str = oss.str();
                if (str.size() > 140) {
                    str = str.substr(0, 140) + "...";
                }
            }
            item.set("value", str);
        }

        result.set(index++, item);
    }

    // Append variant sets as pseudo-attributes at the end
    const UsdVariantSets variantSets = prim.GetVariantSets();
    for (const std::string& vsName : variantSets.GetNames()) {
        const UsdVariantSet vs = variantSets.GetVariantSet(vsName);
        emscripten::val item = emscripten::val::object();
        item.set("name", vsName);
        item.set("typeName", std::string("variantSet"));
        item.set("isAuthored", true);
        item.set("value", vs.GetVariantSelection());

        const std::vector<std::string> variantNames = vs.GetVariantNames();
        emscripten::val options = emscripten::val::array();
        for (size_t i = 0; i < variantNames.size(); ++i) {
            options.set(i, variantNames[i]);
        }
        item.set("variantOptions", options);

        result.set(index++, item);
    }

    return result;
}

bool
ReopenStage(const std::string& stagePath)
{
    SdfLayerHandle layer = SdfLayer::Find(stagePath);

    if (layer && g_stageCache.count(stagePath)) {
        // Fast path: reload fires SdfNotice::LayersDidChange to the living
        // stage. USD's PCP change-processing recomposes only the prim subtrees
        // whose fields actually changed (e.g. one VariantSelection field) —
        // not the whole stage. For large scenes this is orders of magnitude
        // cheaper than a full UsdStage::Open.
        layer->Reload(/* force= */ true);
        return true;
    }

    // Slow path: stage not yet cached or layer not in registry.
    // Reload first so UsdStage::Open reads the updated VFS content.
    if (layer) {
        layer->Reload(/* force= */ true);
    }
    g_stageCache.erase(stagePath);
    UsdStageRefPtr newStage = UsdStage::Open(stagePath);
    if (!newStage) return false;
    g_stageCache[stagePath] = newStage;
    return true;
}

bool
SetVariantSelection(
    const std::string& stagePath,
    const std::string& primPath,
    const std::string& variantSetName,
    const std::string& selection)
{
    UsdStageRefPtr stage = _GetOrOpenStage(stagePath);
    if (!stage) return false;

    const UsdPrim prim = stage->GetPrimAtPath(SdfPath(primPath));
    if (!prim) return false;

    UsdVariantSet vs = prim.GetVariantSets().GetVariantSet(variantSetName);
    if (!vs.IsValid()) return false;

    // Write the selection into the session layer (strongest arc, fully
    // in-memory). Unlike root-layer edits this does not touch the VFS,
    // sidestepping the MEMFS write restrictions that broke earlier attempts.
    // Verify by reading back rather than trusting the return value — WASM
    // TfType/RTTI issues can cause SetVariantSelection to report false even
    // when the write succeeded.
    {
        UsdEditContext ctx(stage, stage->GetSessionLayer());
        vs.SetVariantSelection(selection);
    }
    return vs.GetVariantSelection() == selection;
}

bool
SetPayloadLoaded(
    const std::string& stagePath,
    const std::string& primPath,
    bool loaded)
{
    UsdStageRefPtr stage = _GetOrOpenStage(stagePath);
    if (!stage) return false;

    const SdfPath path(primPath);
    if (loaded) {
        stage->Load(path);
    } else {
        stage->Unload(path);
    }
    const UsdPrim prim = stage->GetPrimAtPath(path);
    return prim && prim.IsLoaded() == loaded;
}

void
SetAllPayloadsLoaded(const std::string& stagePath, bool loaded)
{
    UsdStageRefPtr stage = _GetOrOpenStage(stagePath);
    if (!stage) return;

    const auto traversePredicate =
        UsdPrimIsActive && UsdPrimIsDefined && !UsdPrimIsAbstract;

    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot(), traversePredicate)) {
        if (prim.HasPayload()) {
            if (loaded) {
                stage->Load(prim.GetPath());
            } else {
                stage->Unload(prim.GetPath());
            }
        }
    }
}

EMSCRIPTEN_BINDINGS(usdWebViewBindings)
{
    emscripten::function("InitializeRuntime", &InitializeRuntime);
    emscripten::function("GetRuntimeDiagnostics", &GetRuntimeDiagnostics);
    emscripten::function("InspectPrimRelationships", &InspectPrimRelationships);
    emscripten::function("ExtractRenderables", &ExtractRenderables);
    emscripten::function("ExtractTransformsAtTime", &ExtractTransformsAtTime);
    emscripten::function("OpenStage", &OpenStage);
    emscripten::function("GetSceneGraph", &GetSceneGraph);
    emscripten::function("GetPrimAttributes", &GetPrimAttributes);
    emscripten::function("ReopenStage", &ReopenStage);
    emscripten::function("SetVariantSelection", &SetVariantSelection);
    emscripten::function("SetPayloadLoaded", &SetPayloadLoaded);
    emscripten::function("SetAllPayloadsLoaded", &SetAllPayloadsLoaded);
}
