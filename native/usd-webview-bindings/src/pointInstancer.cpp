#include "webviewCommon.h"

namespace usdwebview {

bool
_PathHasPrefixInList(
    const SdfPath& path,
    const std::vector<SdfPath>& prefixes)
{
    for (const SdfPath& prefix : prefixes) {
        if (path == prefix || path.HasPrefix(prefix)) {
            return true;
        }
    }
    return false;
}

std::vector<SdfPath>
_CollectPointInstancerPrototypeRoots(const UsdStageRefPtr& stage)
{
    std::vector<SdfPath> roots;
    if (!stage) {
        return roots;
    }

    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot())) {
        if (!prim.IsA<UsdGeomPointInstancer>()) {
            continue;
        }

        SdfPathVector prototypePaths;
        UsdGeomPointInstancer(prim).GetPrototypesRel().GetTargets(&prototypePaths);
        roots.insert(roots.end(), prototypePaths.begin(), prototypePaths.end());
    }

    return roots;
}

std::string
_MakePointInstancerRenderablePath(
    const SdfPath& instancerPath,
    const SdfPath& prototypeRootPath,
    const SdfPath& meshPath)
{
    std::string suffix = meshPath.GetString();
    const std::string prototypeRoot = prototypeRootPath.GetString();
    if (TfStringStartsWith(suffix, prototypeRoot)) {
        suffix = suffix.substr(prototypeRoot.size());
    }
    if (suffix.empty() || suffix[0] != '/') {
        suffix = "/" + suffix;
    }

    return instancerPath.GetString() +
        "/__instances__/" +
        prototypeRootPath.GetName() +
        suffix;
}

void
_AppendPointInstancerRenderablesAtTime(
    emscripten::val* renderables,
    size_t* renderableIndex,
    const std::string& stagePath,
    const UsdStageRefPtr& stage,
    const std::string& packageRootPath,
    UsdTimeCode timeCode,
    bool includeMaterials,
    const SdfPath& rootPath,
    const std::vector<SdfPath>& prototypeRoots,
    const UsdSkelCache* skelCache,
    UsdShadeMaterialBindingAPI::BindingsCache* bindingsCache,
    UsdShadeMaterialBindingAPI::CollectionQueryCache* collectionQueryCache)
{
    if (!renderables || !renderableIndex || !stage) {
        return;
    }

    const bool collectAll =
        rootPath == SdfPath::AbsoluteRootPath() || rootPath.IsEmpty();
    UsdGeomXformCache xformCache(timeCode);

    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot())) {
        if (!prim.IsA<UsdGeomPointInstancer>()) {
            continue;
        }
        if (!collectAll &&
            prim.GetPath() != rootPath &&
            !prim.GetPath().HasPrefix(rootPath)) {
            continue;
        }

        UsdGeomPointInstancer instancer(prim);
        SdfPathVector prototypePaths;
        if (!instancer.GetPrototypesRel().GetTargets(&prototypePaths) ||
            prototypePaths.empty()) {
            continue;
        }

        VtIntArray protoIndices;
        if (!instancer.GetProtoIndicesAttr().Get(&protoIndices, timeCode) ||
            protoIndices.empty()) {
            continue;
        }

        std::vector<bool> mask = instancer.ComputeMaskAtTime(timeCode);
        VtArray<GfMatrix4d> instanceTransforms;
        if (!instancer.ComputeInstanceTransformsAtTime(
                &instanceTransforms,
                timeCode,
                timeCode,
                UsdGeomPointInstancer::IncludeProtoXform,
                UsdGeomPointInstancer::IgnoreMask) ||
            instanceTransforms.size() != protoIndices.size()) {
            continue;
        }

        std::vector<std::vector<GfMatrix4d>> matricesByPrototype(prototypePaths.size());
        for (size_t instanceIndex = 0; instanceIndex < protoIndices.size(); ++instanceIndex) {
            if (!mask.empty() &&
                (instanceIndex >= mask.size() || !mask[instanceIndex])) {
                continue;
            }

            const int prototypeIndex = protoIndices[instanceIndex];
            if (prototypeIndex < 0 ||
                static_cast<size_t>(prototypeIndex) >= prototypePaths.size()) {
                continue;
            }

            matricesByPrototype[prototypeIndex].push_back(instanceTransforms[instanceIndex]);
        }

        const GfMatrix4d instancerWorld = xformCache.GetLocalToWorldTransform(prim);
        for (size_t prototypeIndex = 0; prototypeIndex < prototypePaths.size(); ++prototypeIndex) {
            if (matricesByPrototype[prototypeIndex].empty()) {
                continue;
            }

            const SdfPath& prototypeRootPath = prototypePaths[prototypeIndex];
            const UsdPrim prototypeRootPrim = stage->GetPrimAtPath(prototypeRootPath);
            if (!prototypeRootPrim) {
                continue;
            }

            const GfMatrix4d prototypeRootWorld =
                xformCache.GetLocalToWorldTransform(prototypeRootPrim);

            for (const UsdPrim& prototypePrim : UsdPrimRange(prototypeRootPrim)) {
                if (!prototypePrim.IsA<UsdGeomMesh>()) {
                    continue;
                }
                if (!_PathHasPrefixInList(prototypePrim.GetPath(), prototypeRoots)) {
                    continue;
                }

                UsdGeomMesh mesh(prototypePrim);
                MeshPayload payload;
                if (!_ExtractMeshPayload(
                        mesh,
                        &payload,
                        timeCode,
                        skelCache,
                        _FindSkeletonForSkinnedPrim(stagePath, prototypePrim),
                        &xformCache)) {
                    continue;
                }

                const GfMatrix4d meshLocalToPrototypeRoot =
                    xformCache.GetLocalToWorldTransform(prototypePrim) *
                    prototypeRootWorld.GetInverse();

                std::vector<GfMatrix4d> combinedInstanceMatrices;
                combinedInstanceMatrices.reserve(matricesByPrototype[prototypeIndex].size());
                for (const GfMatrix4d& instanceMatrix : matricesByPrototype[prototypeIndex]) {
                    combinedInstanceMatrices.push_back(
                        meshLocalToPrototypeRoot * instanceMatrix);
                }

                emscripten::val renderable = emscripten::val::object();
                renderable.set(
                    "path",
                    _MakePointInstancerRenderablePath(
                        prim.GetPath(),
                        prototypeRootPath,
                        prototypePrim.GetPath()));
                renderable.set("name", prototypePrim.GetName().GetString());
                renderable.set("points", _FloatArray(payload.points));
                renderable.set("indices", _IntArray(payload.triangleIndices));
                if (!payload.uvs.empty()) {
                    renderable.set("uvs", _FloatArray(payload.uvs));
                }
                renderable.set("matrix", _MatrixArray(instancerWorld));
                renderable.set("instanceMatrices", _MatrixArrayVector(combinedInstanceMatrices));
                renderable.set("instanceOwnerPath", prim.GetPath().GetString());
                renderable.set("color", _ColorArray(mesh));
                if (includeMaterials) {
                    renderable.set(
                        "material",
                        _ExtractMaterial(
                            prototypePrim,
                            packageRootPath,
                            bindingsCache,
                            collectionQueryCache,
                            renderable["color"]));
                    _MaybeSetRenderableMaterialSubsets(
                        &renderable,
                        mesh,
                        payload,
                        packageRootPath,
                        bindingsCache,
                        collectionQueryCache);
                }

                renderables->set((*renderableIndex)++, renderable);
            }
        }
    }
}

} // namespace usdwebview
