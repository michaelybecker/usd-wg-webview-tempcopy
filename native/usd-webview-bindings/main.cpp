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
#include "pxr/usd/sdf/usdzFileFormat.h"
#include "pxr/usd/sdf/usdzResolver.h"
#include "pxr/usd/usd/attribute.h"
#include "pxr/usd/usd/prim.h"
#include "pxr/usd/usd/primRange.h"
#include "pxr/usd/usd/relationship.h"
#include "pxr/usd/usd/stage.h"
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
#include <string>
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
            if (!relationship.GetForwardedTargets(&targets)) {
                continue;
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
            if (!relationship.GetForwardedTargets(&targets)) {
                continue;
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

    return UsdPrim();
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
    const std::string extension = TfStringToLower(TfGetExtension(path));
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

        if (relationship.GetForwardedTargets(&targets) && !targets.empty()) {
            return materialPrim.GetStage()->GetPrimAtPath(targets[0].GetPrimPath());
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

    GfVec3f diffuseColor;
    if ((shader && _GetInputColor(shader, TfToken("diffuseColor"), &diffuseColor)) ||
        _GetAuthoredInputColor(shaderPrim, TfToken("diffuseColor"), &diffuseColor)) {
        materialValue.set("diffuseColor", _Vec3Array(diffuseColor));
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

    std::string texturePath;
    if ((shader && _GetConnectedTexturePath(shader, TfToken("diffuseColor"), &texturePath)) ||
        _GetAuthoredConnectedTexturePath(shaderPrim, TfToken("diffuseColor"), &texturePath)) {
        emscripten::val texture = _ReadTextureAsset(texturePath, packageRootPath);
        if (!texture["data"].isUndefined()) {
            materialValue.set("diffuseTexture", texture);
        }
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
            if (relationship.GetForwardedTargets(&targets)) {
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
    UsdStageRefPtr stage = UsdStage::Open(path);
    if (!stage) {
        return renderables;
    }

    UsdGeomXformCache xformCache(stage->GetStartTimeCode());
    UsdShadeMaterialBindingAPI::BindingsCache bindingsCache;
    UsdShadeMaterialBindingAPI::CollectionQueryCache collectionQueryCache;
    const std::string packageRootPath = _GetLayerIdentifier(stage->GetRootLayer());
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
    UsdStageRefPtr stage = UsdStage::Open(path);
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

EMSCRIPTEN_BINDINGS(usdWebViewBindings)
{
    emscripten::function("InitializeRuntime", &InitializeRuntime);
    emscripten::function("GetRuntimeDiagnostics", &GetRuntimeDiagnostics);
    emscripten::function("InspectPrimRelationships", &InspectPrimRelationships);
    emscripten::function("ExtractRenderables", &ExtractRenderables);
    emscripten::function("OpenStage", &OpenStage);
}
