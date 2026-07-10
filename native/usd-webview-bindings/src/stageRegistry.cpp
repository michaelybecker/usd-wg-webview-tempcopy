#include "webviewCommon.h"

namespace usdwebview {

std::unordered_map<std::string, StageRecord> g_stageRegistry;

StageRecord&
_GetStageRecord(const std::string& path)
{
    return g_stageRegistry[path];
}

std::string
_GetLayerIdentifier(const SdfLayerHandle& layer)
{
    return layer ? layer->GetIdentifier() : std::string();
}

// Cache to avoid re-opening the stage on every ExtractTransformsAtTime call.
// Key is the normalized stage path passed by the JS caller.

UsdStageRefPtr
_OpenStageWithPayloadPolicy(const std::string& path, bool loadAllPayloads)
{
    return UsdStage::Open(
        path,
        loadAllPayloads ? UsdStage::LoadAll : UsdStage::LoadNone);
}

UsdStageRefPtr
_GetOrOpenStage(const std::string& path, bool loadAllPayloads)
{
    auto it = g_stageRegistry.find(path);
    if (it != g_stageRegistry.end() && it->second.stage) {
        return it->second.stage;
    }
    UsdStageRefPtr stage = _OpenStageWithPayloadPolicy(path, loadAllPayloads);
    if (stage) {
        StageRecord& record = _GetStageRecord(path);
        record.stage = stage;
        record.loadAllPayloadsOnOpen = loadAllPayloads;
    }
    return stage;
}

void
_InvalidateDerivedStageCaches(const std::string& path)
{
    auto it = g_stageRegistry.find(path);
    if (it != g_stageRegistry.end()) {
        it->second.ResetDerivedCaches();
    }
}

UsdSkelCache*
_GetOrPopulateSkelCache(const std::string& path, const UsdStageRefPtr& stage)
{
    StageRecord& record = _GetStageRecord(path);
    if (!record.authoredLegacySkelBindingTargets.has_value()) {
        LegacySkelBindingAuthoringDiagnostics diagnostics;
        if (stage && stage->GetSessionLayer()) {
            diagnostics.sessionLayerIdentifier =
                stage->GetSessionLayer()->GetIdentifier();
        }
        record.authoredLegacySkelBindingTargets = 0;
        record.legacySkelBindingDiagnostics = diagnostics;
    }

    if (record.hasSkelRoot.has_value() && !*record.hasSkelRoot) {
        return nullptr;
    }

    if (record.skelCache) {
        return record.skelCache.get();
    }

    auto cache = std::make_unique<UsdSkelCache>();
    auto& skeletonByPrim = record.skinningSkeletonByPrim;
    skeletonByPrim.clear();
    bool hasSkelRoot = false;
    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot())) {
        if (prim.IsA<UsdSkelRoot>()) {
            const UsdSkelRoot skelRoot(prim);
            cache->Populate(skelRoot, UsdTraverseInstanceProxies());
            std::vector<UsdSkelBinding> bindings;
            if (cache->ComputeSkelBindings(
                    skelRoot,
                    &bindings,
                    UsdTraverseInstanceProxies())) {
                for (const UsdSkelBinding& binding : bindings) {
                    for (const UsdSkelSkinningQuery& skinningQuery :
                         binding.GetSkinningTargets()) {
                        skeletonByPrim[
                            skinningQuery.GetPrim().GetPath().GetString()] =
                            binding.GetSkeleton();
                    }
                }
            }
            hasSkelRoot = true;
        }
    }

    record.hasSkelRoot = hasSkelRoot;
    if (!hasSkelRoot) {
        return nullptr;
    }

    UsdSkelCache* result = cache.get();
    record.skelCache = std::move(cache);
    return result;
}

UsdSkelSkeleton
_FindSkeletonForSkinnedPrim(const std::string& stagePath, const UsdPrim& prim)
{
    auto stageIt = g_stageRegistry.find(stagePath);
    if (stageIt == g_stageRegistry.end()) {
        return UsdSkelSkeleton();
    }
    const auto& skeletonByPrim = stageIt->second.skinningSkeletonByPrim;
    auto primIt = skeletonByPrim.find(prim.GetPath().GetString());
    if (primIt != skeletonByPrim.end()) {
        return primIt->second;
    }

    UsdPrim skeleton = _InferSkeletonForSkelBoundPrim(prim);
    return skeleton ? UsdSkelSkeleton(skeleton) : UsdSkelSkeleton();
}

} // namespace usdwebview
