#include "pxr/pxr.h"

#include "pxr/base/plug/registry.h"
#include "pxr/base/tf/fileUtils.h"
#include "pxr/base/tf/pathUtils.h"
#include "pxr/base/tf/stringUtils.h"
#include "pxr/base/vt/array.h"
#include "pxr/base/gf/half.h"
#include "pxr/base/gf/matrix4d.h"
#include "pxr/base/gf/quath.h"
#include "pxr/base/gf/vec2f.h"
#include "pxr/base/gf/vec3d.h"
#include "pxr/base/gf/vec3f.h"
#include "pxr/base/gf/vec3h.h"
#include "pxr/base/tf/token.h"
#include "pxr/imaging/hd/bprim.h"
#include "pxr/imaging/hd/camera.h"
#include "pxr/imaging/hd/changeTracker.h"
#include "pxr/imaging/hd/coordSys.h"
#include "pxr/imaging/hd/extComputation.h"
#include "pxr/imaging/hd/extComputationUtils.h"
#include "pxr/imaging/hd/filteringSceneIndex.h"
#include "pxr/imaging/hd/instancer.h"
#include "pxr/imaging/hd/light.h"
#include "pxr/imaging/hd/material.h"
#include "pxr/imaging/hd/mesh.h"
#include "pxr/imaging/hd/overlayContainerDataSource.h"
#include "pxr/imaging/hd/renderDelegate.h"
#include "pxr/imaging/hd/renderIndex.h"
#include "pxr/imaging/hd/resourceRegistry.h"
#include "pxr/imaging/hd/retainedDataSource.h"
#include "pxr/imaging/hd/tokens.h"
#include "pxr/imaging/hdsi/sceneGlobalsSceneIndex.h"
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
#include "pxr/usd/usd/timeCode.h"
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
#include "pxr/usd/usdSkel/animQuery.h"
#include "pxr/usd/usdSkel/animMapper.h"
#include "pxr/usd/usdSkel/animation.h"
#include "pxr/usd/usdSkel/binding.h"
#include "pxr/usd/usdSkel/bindingAPI.h"
#include "pxr/usd/usdSkel/cache.h"
#include "pxr/usd/usdSkel/root.h"
#include "pxr/usd/usdSkel/skeleton.h"
#include "pxr/usd/usdSkel/skeletonQuery.h"
#include "pxr/usd/usdSkel/skinningQuery.h"
#include "pxr/usd/usdSkel/utils.h"
#include "pxr/usdImaging/usdImaging/delegate.h"
#include "pxr/usdImaging/usdSkelImaging/animationAdapter.h"
#include "pxr/usdImaging/usdSkelImaging/animationSchema.h"
#include "pxr/usdImaging/usdSkelImaging/bindingAPIAdapter.h"
#include "pxr/usdImaging/usdSkelImaging/bindingSchema.h"
#include "pxr/usdImaging/usdSkelImaging/blendShapeAdapter.h"
#include "pxr/usdImaging/usdSkelImaging/resolvedSkeletonSchema.h"
#include "pxr/usdImaging/usdSkelImaging/resolvingSceneIndexPlugin.h"
#include "pxr/usdImaging/usdSkelImaging/skelRootAdapter.h"
#include "pxr/usdImaging/usdSkelImaging/skeletonAdapter.h"
#include "pxr/usdImaging/usdImaging/sceneIndices.h"
#include "pxr/usdImaging/usdImaging/stageSceneIndex.h"

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <memory>
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

struct HydraMeshUpdate
{
    std::string path;
    std::string name;
    std::vector<float> points;
    std::vector<int> triangleIndices;
    std::vector<float> uvs;
    GfMatrix4d matrix;
    int pointComputationCount = 0;
    int sceneIndexChildCount = 0;
    bool sceneIndexHasSkelRoot = false;
    std::string sceneIndexSkeletonPath;
    std::string sceneIndexAnimationSourcePath;
    std::string sceneIndexAnimationPrimType;
    int sceneIndexAnimationJointCount = 0;
    int sceneIndexAnimationTranslationCount = 0;
    double sceneIndexAnimationTranslationSum = 0.0;
    int sceneIndexAnimationRotationCount = 0;
    double sceneIndexAnimationRotationSum = 0.0;
    int sceneIndexAnimationScaleCount = 0;
    double sceneIndexAnimationScaleSum = 0.0;
    int sceneIndexSkinningTransformCount = 0;
    double sceneIndexSkinningTransformSum = 0.0;
    double sceneIndexSkinningTransformWeightedSum = 0.0;
    bool usedComputedPoints = false;
    bool usdSkelFallbackAvailable = false;
};

struct HydraDiagnostics
{
    int createdMeshRprims = 0;
    int createdExtComputations = 0;
    int createdMaterials = 0;
};

struct LegacySkelBindingAuthoringDiagnostics
{
    int skeletonPrims = 0;
    int animationTargets = 0;
    int meshPrims = 0;
    int meshSkinningQueries = 0;
    int meshInferredSkeletons = 0;
    int relationshipSpecs = 0;
};

SdfPrimSpecHandle
_EnsurePrimSpecInLayer(const SdfLayerHandle& layer, const SdfPath& primPath)
{
    if (!layer || !primPath.IsAbsolutePath() || !primPath.IsPrimPath()) {
        return SdfPrimSpecHandle();
    }

    static std::unordered_map<std::string, SdfPrimSpecHandle> s_primSpecCache;
    const std::string cachePrefix = layer->GetIdentifier() + "|";
    auto cachedIt = s_primSpecCache.find(cachePrefix + primPath.GetString());
    if (cachedIt != s_primSpecCache.end() && cachedIt->second) {
        return cachedIt->second;
    }

    SdfChangeBlock changeBlock;
    SdfPrimSpecHandle primSpec = layer->GetPseudoRoot();
    for (const SdfPath& prefix : primPath.GetPrefixes()) {
        if (prefix == SdfPath::AbsoluteRootPath()) {
            continue;
        }
        if (!primSpec) {
            return SdfPrimSpecHandle();
        }

        SdfPrimSpecHandle childSpec;
        const std::string name = prefix.GetName();
        for (const SdfPrimSpecHandle& child : primSpec->GetNameChildren()) {
            if (child && child->GetName() == name) {
                childSpec = child;
                break;
            }
        }
        if (!childSpec) {
            childSpec = SdfPrimSpec::New(
                primSpec,
                name,
                SdfSpecifierOver,
                std::string());
        }
        primSpec = childSpec;
        if (primSpec) {
            s_primSpecCache[cachePrefix + prefix.GetString()] = primSpec;
        }
    }

    s_primSpecCache[cachePrefix + primPath.GetString()] = primSpec;
    return primSpec;
}

class WebViewHydraMeshCollector
{
public:
    void Clear()
    {
        updates.clear();
    }

    void Record(HydraMeshUpdate update)
    {
        updates[update.path] = std::move(update);
    }

    std::unordered_map<std::string, HydraMeshUpdate> updates;
    HydraDiagnostics diagnostics;
};

bool
_CopyHydraPoints(const VtValue& value, std::vector<float>* points)
{
    points->clear();
    if (value.IsHolding<VtArray<GfVec3f>>()) {
        const VtArray<GfVec3f>& array = value.UncheckedGet<VtArray<GfVec3f>>();
        points->reserve(array.size() * 3);
        for (const GfVec3f& point : array) {
            points->push_back(point[0]);
            points->push_back(point[1]);
            points->push_back(point[2]);
        }
        return !points->empty();
    }
    if (value.IsHolding<VtArray<GfVec3d>>()) {
        const VtArray<GfVec3d>& array = value.UncheckedGet<VtArray<GfVec3d>>();
        points->reserve(array.size() * 3);
        for (const GfVec3d& point : array) {
            points->push_back(static_cast<float>(point[0]));
            points->push_back(static_cast<float>(point[1]));
            points->push_back(static_cast<float>(point[2]));
        }
        return !points->empty();
    }
    return false;
}

std::vector<int>
_TriangulateHydraTopology(const HdMeshTopology& topology)
{
    std::vector<int> triangles;
    const VtIntArray& counts = topology.GetFaceVertexCounts();
    const VtIntArray& indices = topology.GetFaceVertexIndices();

    size_t cursor = 0;
    for (int count : counts) {
        if (count < 3 || cursor + static_cast<size_t>(count) > indices.size()) {
            cursor += std::max(count, 0);
            continue;
        }

        for (int i = 1; i + 1 < count; ++i) {
            triangles.push_back(indices[cursor]);
            triangles.push_back(indices[cursor + i]);
            triangles.push_back(indices[cursor + i + 1]);
        }
        cursor += count;
    }

    return triangles;
}

bool
_BuildHydraMeshUpdateFromSceneDelegate(
    HdSceneDelegate* delegate,
    SdfPath const& id,
    HydraMeshUpdate* update,
    float computationSampleOffset = 0.0f);

class WebViewHydraMesh final : public HdMesh
{
public:
    WebViewHydraMesh(SdfPath const& id, WebViewHydraMeshCollector* collector)
        : HdMesh(id)
        , _collector(collector)
    {
    }

    void Sync(
        HdSceneDelegate* delegate,
        HdRenderParam* renderParam,
        HdDirtyBits* dirtyBits,
        TfToken const& reprToken) override
    {
        const SdfPath& id = GetId();
        if (!_collector || !dirtyBits || *dirtyBits == HdChangeTracker::Clean) {
            return;
        }

        HydraMeshUpdate update;
        if (_BuildHydraMeshUpdateFromSceneDelegate(delegate, id, &update)) {
            _collector->Record(std::move(update));
        }

        *dirtyBits &= ~HdChangeTracker::AllSceneDirtyBits;
    }

    HdDirtyBits GetInitialDirtyBitsMask() const override
    {
        return HdChangeTracker::AllSceneDirtyBits & ~HdChangeTracker::Varying;
    }

protected:
    HdDirtyBits _PropagateDirtyBits(HdDirtyBits bits) const override
    {
        return bits;
    }

    void _InitRepr(TfToken const& reprToken, HdDirtyBits* dirtyBits) override
    {
        auto it = std::find_if(
            _reprs.begin(),
            _reprs.end(),
            _ReprComparator(reprToken));
        if (it == _reprs.end()) {
            _reprs.emplace_back(reprToken, HdReprSharedPtr());
        }
    }

private:
    WebViewHydraMeshCollector* _collector;
};

template <typename Base>
class WebViewHydraSprim final : public Base
{
public:
    explicit WebViewHydraSprim(SdfPath const& id)
        : Base(id)
    {
    }

    void Sync(
        HdSceneDelegate* sceneDelegate,
        HdRenderParam* renderParam,
        HdDirtyBits* dirtyBits) override
    {
        *dirtyBits = Base::Clean;
    }

    HdDirtyBits GetInitialDirtyBitsMask() const override
    {
        return Base::AllDirty;
    }
};

class WebViewHydraRenderDelegate final : public HdRenderDelegate
{
public:
    explicit WebViewHydraRenderDelegate(WebViewHydraMeshCollector* collector)
        : _collector(collector)
    {
    }

    const TfTokenVector& GetSupportedRprimTypes() const override
    {
        static const TfTokenVector tokens = { HdPrimTypeTokens->mesh };
        return tokens;
    }

    const TfTokenVector& GetSupportedSprimTypes() const override
    {
        static const TfTokenVector tokens = {
            HdPrimTypeTokens->camera,
            HdPrimTypeTokens->coordSys,
            HdPrimTypeTokens->domeLight,
            HdPrimTypeTokens->extComputation,
            HdPrimTypeTokens->material
        };
        return tokens;
    }

    const TfTokenVector& GetSupportedBprimTypes() const override
    {
        static const TfTokenVector tokens;
        return tokens;
    }

    HdRenderParam* GetRenderParam() const override
    {
        return nullptr;
    }

    HdResourceRegistrySharedPtr GetResourceRegistry() const override
    {
        static HdResourceRegistrySharedPtr registry(new HdResourceRegistry);
        return registry;
    }

    HdRenderPassSharedPtr CreateRenderPass(
        HdRenderIndex* index,
        HdRprimCollection const& collection) override
    {
        return HdRenderPassSharedPtr();
    }

    HdInstancer* CreateInstancer(
        HdSceneDelegate* delegate,
        SdfPath const& id) override
    {
        return new HdInstancer(delegate, id);
    }

    void DestroyInstancer(HdInstancer* instancer) override
    {
        delete instancer;
    }

    HdRprim* CreateRprim(TfToken const& typeId, SdfPath const& rprimId) override
    {
        if (typeId == HdPrimTypeTokens->mesh) {
            if (_collector) {
                ++_collector->diagnostics.createdMeshRprims;
            }
            return new WebViewHydraMesh(rprimId, _collector);
        }
        return nullptr;
    }

    void DestroyRprim(HdRprim* rprim) override
    {
        delete rprim;
    }

    HdSprim* CreateSprim(TfToken const& typeId, SdfPath const& sprimId) override
    {
        if (typeId == HdPrimTypeTokens->material) {
            if (_collector) {
                ++_collector->diagnostics.createdMaterials;
            }
            return new WebViewHydraSprim<HdMaterial>(sprimId);
        }
        if (typeId == HdPrimTypeTokens->camera) {
            return new WebViewHydraSprim<HdCamera>(sprimId);
        }
        if (typeId == HdPrimTypeTokens->coordSys) {
            return new WebViewHydraSprim<HdCoordSys>(sprimId);
        }
        if (typeId == HdPrimTypeTokens->domeLight) {
            return new WebViewHydraSprim<HdLight>(sprimId);
        }
        if (typeId == HdPrimTypeTokens->extComputation) {
            if (_collector) {
                ++_collector->diagnostics.createdExtComputations;
            }
            return new HdExtComputation(sprimId);
        }
        return nullptr;
    }

    HdSprim* CreateFallbackSprim(TfToken const& typeId) override
    {
        return CreateSprim(typeId, SdfPath::EmptyPath());
    }

    void DestroySprim(HdSprim* sprim) override
    {
        delete sprim;
    }

    HdBprim* CreateBprim(TfToken const& typeId, SdfPath const& bprimId) override
    {
        return nullptr;
    }

    HdBprim* CreateFallbackBprim(TfToken const& typeId) override
    {
        return nullptr;
    }

    void DestroyBprim(HdBprim* bprim) override
    {
        delete bprim;
    }

    void CommitResources(HdChangeTracker* tracker) override
    {
    }

private:
    WebViewHydraMeshCollector* _collector;
};

bool
_BuildHydraMeshUpdateFromSceneDelegate(
    HdSceneDelegate* delegate,
    SdfPath const& id,
    HydraMeshUpdate* update,
    float computationSampleOffset)
{
    if (!delegate || !update) {
        return false;
    }

    update->path = id.GetString();
    update->name = id.GetName();
    update->matrix = delegate->GetTransform(id);
    update->triangleIndices =
        _TriangulateHydraTopology(delegate->GetMeshTopology(id));

    VtValue pointsValue = delegate->Get(id, HdTokens->points);
    HdExtComputationPrimvarDescriptorVector pointsComputations;
    for (size_t i = 0; i < HdInterpolationCount; ++i) {
        HdInterpolation interpolation = static_cast<HdInterpolation>(i);
        HdExtComputationPrimvarDescriptorVector descriptors =
            delegate->GetExtComputationPrimvarDescriptors(id, interpolation);
        for (const HdExtComputationPrimvarDescriptor& descriptor : descriptors) {
            if (descriptor.name == HdTokens->points) {
                pointsComputations.push_back(descriptor);
            }
        }
    }

    if (!pointsComputations.empty()) {
        update->pointComputationCount =
            static_cast<int>(pointsComputations.size());
        if (computationSampleOffset != 0.0f) {
            HdExtComputationUtils::SampledValueStore<4> computedValues;
            HdExtComputationUtils::SampleComputedPrimvarValues<4>(
                pointsComputations,
                delegate,
                computationSampleOffset,
                computationSampleOffset,
                4,
                &computedValues);
            auto it = computedValues.find(HdTokens->points);
            if (it != computedValues.end() && it->second.count > 0) {
                pointsValue = it->second.values[it->second.count - 1];
                update->usedComputedPoints = true;
            }
        } else {
            HdExtComputationUtils::ValueStore computedValues =
                HdExtComputationUtils::GetComputedPrimvarValues(
                    pointsComputations,
                    delegate);
            auto it = computedValues.find(HdTokens->points);
            if (it != computedValues.end() && !it->second.IsEmpty()) {
                pointsValue = it->second;
                update->usedComputedPoints = true;
            }
        }
    }

    return !update->triangleIndices.empty() &&
        _CopyHydraPoints(pointsValue, &update->points);
}

bool
_BuildHydraMeshUpdate(
    HdRenderIndex* renderIndex,
    SdfPath const& id,
    HydraMeshUpdate* update,
    float computationSampleOffset = 0.0f)
{
    if (!renderIndex || !renderIndex->HasRprim(id)) {
        return false;
    }
    HdSceneDelegate* delegate = renderIndex->GetSceneDelegateForRprim(id);
    return _BuildHydraMeshUpdateFromSceneDelegate(
        delegate,
        id,
        update,
        computationSampleOffset);
}

UsdSkelSkeleton
_FindSkeletonForSkinnedPrim(const std::string& stagePath, const UsdPrim& prim);

UsdPrim
_InferAnimationForSkeleton(const UsdPrim& skeleton);

HdContainerDataSourceHandle
_BuildSkelBindingRepairDataSource(
    const std::string& stagePath,
    const UsdPrim& prim)
{
    if (!prim) {
        return nullptr;
    }

    UsdSkelBindingAPI binding(prim);
    HdPathDataSourceHandle animationSourceDs;
    HdPathDataSourceHandle skeletonDs;
    HdBoolDataSourceHandle hasSkelRootDs;

    SdfPath animationSourcePath;
    if (UsdRelationship animationSourceRel =
            prim.GetRelationship(UsdSkelTokens->skelAnimationSource)) {
        SdfPathVector targets;
        if (animationSourceRel.GetTargets(&targets) && !targets.empty()) {
            animationSourcePath = targets.front();
        }
    }
    if (animationSourcePath.IsEmpty()) {
        if (UsdPrim animationSource = binding.GetInheritedAnimationSource()) {
            animationSourcePath = animationSource.GetPath();
        }
    }
    if (animationSourcePath.IsEmpty()) {
        if (UsdPrim animationSource =
                _InferAnimationForSkeleton(prim)) {
            animationSourcePath = animationSource.GetPath();
        }
    }
    if (!animationSourcePath.IsEmpty()) {
        animationSourceDs =
            HdRetainedTypedSampledDataSource<SdfPath>::New(
                animationSourcePath);
    }

    SdfPath skeletonPath;
    if (UsdRelationship skeletonRel =
            prim.GetRelationship(UsdSkelTokens->skelSkeleton)) {
        SdfPathVector targets;
        if (skeletonRel.GetTargets(&targets) && !targets.empty()) {
            skeletonPath = targets.front();
        }
    }
    if (skeletonPath.IsEmpty()) {
        if (UsdSkelSkeleton skeleton = binding.GetInheritedSkeleton()) {
            skeletonPath = skeleton.GetPrim().GetPath();
        }
    }
    if (skeletonPath.IsEmpty()) {
        if (UsdSkelSkeleton skeleton =
                _FindSkeletonForSkinnedPrim(stagePath, prim)) {
            skeletonPath = skeleton.GetPrim().GetPath();
        }
    }
    if (!skeletonPath.IsEmpty()) {
        skeletonDs =
            HdRetainedTypedSampledDataSource<SdfPath>::New(
                skeletonPath);
    }

    if (UsdSkelRoot::Find(prim)) {
        hasSkelRootDs =
            HdRetainedTypedSampledDataSource<bool>::New(true);
    }

    if (!animationSourceDs && !skeletonDs && !hasSkelRootDs) {
        return nullptr;
    }

    return HdRetainedContainerDataSource::New(
        UsdSkelImagingBindingSchema::GetSchemaToken(),
        UsdSkelImagingBindingSchema::BuildRetained(
            animationSourceDs,
            skeletonDs,
            /* joints = */ nullptr,
            /* blendShapes = */ nullptr,
            /* blendShapeTargets = */ nullptr,
            hasSkelRootDs));
}

class WebViewSkelBindingRepairSceneIndex final
    : public HdSingleInputFilteringSceneIndexBase
{
public:
    static HdSceneIndexBaseRefPtr New(
        HdSceneIndexBaseRefPtr const& inputSceneIndex,
        UsdStageRefPtr stage,
        std::string stagePath)
    {
        return TfCreateRefPtr(new WebViewSkelBindingRepairSceneIndex(
            inputSceneIndex,
            std::move(stage),
            std::move(stagePath)));
    }

    HdSceneIndexPrim GetPrim(const SdfPath& primPath) const override
    {
        HdSceneIndexPrim prim = _GetInputSceneIndex()->GetPrim(primPath);
        if (!prim.dataSource || !_stage || primPath.IsAbsoluteRootPath()) {
            return prim;
        }

        UsdPrim usdPrim = _stage->GetPrimAtPath(primPath.GetPrimPath());
        if (!usdPrim) {
            return prim;
        }

        HdContainerDataSourceHandle repairedSkelBinding =
            _BuildSkelBindingRepairDataSource(_stagePath, usdPrim);
        if (!repairedSkelBinding) {
            return prim;
        }

        prim.dataSource = HdOverlayContainerDataSource::New(
            repairedSkelBinding,
            prim.dataSource);
        return prim;
    }

    SdfPathVector GetChildPrimPaths(const SdfPath& primPath) const override
    {
        return _GetInputSceneIndex()->GetChildPrimPaths(primPath);
    }

protected:
    void _PrimsAdded(
        const HdSceneIndexBase&,
        const HdSceneIndexObserver::AddedPrimEntries& entries) override
    {
        _SendPrimsAdded(entries);
    }

    void _PrimsRemoved(
        const HdSceneIndexBase&,
        const HdSceneIndexObserver::RemovedPrimEntries& entries) override
    {
        _SendPrimsRemoved(entries);
    }

    void _PrimsDirtied(
        const HdSceneIndexBase&,
        const HdSceneIndexObserver::DirtiedPrimEntries& entries) override
    {
        _SendPrimsDirtied(entries);
    }

private:
    WebViewSkelBindingRepairSceneIndex(
        HdSceneIndexBaseRefPtr const& inputSceneIndex,
        UsdStageRefPtr stage,
        std::string stagePath)
        : HdSingleInputFilteringSceneIndexBase(inputSceneIndex)
        , _stage(std::move(stage))
        , _stagePath(std::move(stagePath))
    {
    }

    UsdStageRefPtr _stage;
    std::string _stagePath;
};

struct HydraAnimationDriver
{
    HydraAnimationDriver(std::string stagePath, UsdStageRefPtr stage)
        : stage(std::move(stage))
        , stagePath(std::move(stagePath))
        , renderDelegate(&collector)
    {
        renderIndex.reset(HdRenderIndex::New(
            &renderDelegate,
            HdDriverVector()));
        imagingDelegate = std::make_unique<UsdImagingDelegate>(
            renderIndex.get(),
            SdfPath::AbsoluteRootPath());
        if (this->stage) {
            // Give legacy UsdSkelImagingSkelRootAdapter first claim on
            // skinned meshes before the general population traversal reaches
            // the same mesh prims via their regular UsdGeom adapters.
            bool populatedRoot = false;
            for (const UsdPrim& prim : UsdPrimRange(this->stage->GetPseudoRoot())) {
                if (prim.IsA<UsdSkelRoot>()) {
                    imagingDelegate->Populate(prim);
                    populatedRoot = true;
                }
            }
            if (!populatedRoot) {
                imagingDelegate->Populate(this->stage->GetPseudoRoot());
            }
            imagingDelegate->ApplyPendingUpdates();
            imagingDelegate->SyncAll(true);
        }
    }

    UsdStageRefPtr stage;
    std::string stagePath;
    WebViewHydraMeshCollector collector;
    WebViewHydraRenderDelegate renderDelegate;
    std::unique_ptr<HdRenderIndex> renderIndex;
    std::unique_ptr<UsdImagingDelegate> imagingDelegate;
};

std::unordered_map<std::string, std::unique_ptr<HydraAnimationDriver>>
    g_hydraAnimationDrivers;

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
_ForceUsdSkelImagingStaticRegistration()
{
    // In a static WASM link, plugInfo can advertise adapter types whose object
    // files were otherwise not pulled from libusd_usdSkelImaging.a. Touch the
    // concrete adapter classes so their TF_REGISTRY_FUNCTION blocks are linked
    // and the plugin system can manufacture them at runtime.
    static const bool registered = []() {
        UsdSkelImagingAnimationAdapter animationAdapter;
        UsdSkelImagingBindingAPIAdapter bindingAdapter;
        UsdSkelImagingBlendShapeAdapter blendShapeAdapter;
        UsdSkelImagingResolvingSceneIndexPlugin resolvingSceneIndexPlugin;
        UsdSkelImagingSkeletonAdapter skeletonAdapter;
        UsdSkelImagingSkelRootAdapter skelRootAdapter;

        (void)animationAdapter;
        (void)bindingAdapter;
        (void)blendShapeAdapter;
        (void)resolvingSceneIndexPlugin;
        (void)skeletonAdapter;
        (void)skelRootAdapter;
        return true;
    }();
    (void)registered;
}

void
InitializeRuntime()
{
    _ForceUsdSkelImagingStaticRegistration();
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

emscripten::val
_Float32Array(const std::vector<float>& values)
{
    if (values.empty()) {
        return emscripten::val::global("Float32Array").new_(0);
    }
    return emscripten::val::global("Float32Array")
        .new_(emscripten::typed_memory_view(values.size(), values.data()));
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

bool
_RelationshipHasResolvedTargets(const UsdRelationship& relationship)
{
    if (!relationship) {
        return false;
    }

    SdfPathVector targets;
    if (relationship.GetForwardedTargets(&targets) && !targets.empty()) {
        return true;
    }
    targets.clear();
    return relationship.GetTargets(&targets) && !targets.empty();
}

UsdPrim
_FindFirstDescendantOfType(const UsdPrim& root, const TfToken& typeName)
{
    if (!root) {
        return UsdPrim();
    }

    for (const UsdPrim& prim : UsdPrimRange(root)) {
        if (prim == root) {
            continue;
        }
        if (prim.GetTypeName() == typeName) {
            return prim;
        }
    }
    return UsdPrim();
}

UsdPrim
_InferSkeletonForSkelBoundPrim(const UsdPrim& prim)
{
    if (!prim) {
        return UsdPrim();
    }

    static const TfToken kSkeletonType("Skeleton");
    for (UsdPrim ancestor = prim.GetParent();
         ancestor && !ancestor.IsPseudoRoot();
         ancestor = ancestor.GetParent()) {
        UsdPrim skeleton = _FindFirstDescendantOfType(ancestor, kSkeletonType);
        if (skeleton) {
            return skeleton;
        }
    }
    return UsdPrim();
}

UsdPrim
_InferAnimationForSkeleton(const UsdPrim& skeleton)
{
    static const TfToken kSkelAnimationType("SkelAnimation");
    return _FindFirstDescendantOfType(skeleton, kSkelAnimationType);
}

bool
_ComputeInferredSkinningTransforms(
    const UsdSkelCache* skelCache,
    const UsdSkelSkeleton& skeleton,
    UsdTimeCode timeCode,
    VtArray<GfMatrix4d>* skinningTransforms,
    emscripten::val* debugInfo = nullptr)
{
    if (!skelCache || !skeleton || !skinningTransforms) {
        return false;
    }

    UsdPrim animationPrim = _InferAnimationForSkeleton(skeleton.GetPrim());
    if (debugInfo) {
        debugInfo->set("inferredAnimationPrimPath", animationPrim
            ? animationPrim.GetPath().GetString()
            : std::string());
    }
    if (!animationPrim) {
        return false;
    }

    UsdSkelSkeletonQuery skelQuery = skelCache->GetSkelQuery(skeleton);
    UsdSkelAnimQuery animQuery =
        skelCache->GetAnimQuery(UsdSkelAnimation(animationPrim));
    if (!skelQuery || !animQuery) {
        return false;
    }

    VtArray<GfMatrix4d> animLocalTransforms;
    VtTokenArray animJointOrder;
    bool animQueryComputed = false;
    if (animQuery &&
        animQuery.ComputeJointLocalTransforms(&animLocalTransforms, timeCode) &&
        !animLocalTransforms.empty()) {
        animJointOrder = animQuery.GetJointOrder();
        animQueryComputed = true;
    } else {
        UsdSkelAnimation animation(animationPrim);
        VtArray<GfVec3f> translations;
        VtArray<GfQuatf> rotations;
        VtArray<GfVec3h> scales;
        animation.GetJointsAttr().Get(&animJointOrder);
        animation.GetTranslationsAttr().Get(&translations, timeCode);
        animation.GetRotationsAttr().Get(&rotations, timeCode);
        animation.GetScalesAttr().Get(&scales, timeCode);

        size_t transformCount = animJointOrder.size();
        transformCount = std::max(transformCount, translations.size());
        transformCount = std::max(transformCount, rotations.size());
        transformCount = std::max(transformCount, scales.size());
        if (debugInfo) {
            debugInfo->set("rawAnimJointCount", static_cast<int>(animJointOrder.size()));
            debugInfo->set("rawTranslationCount", static_cast<int>(translations.size()));
            debugInfo->set("rawRotationCount", static_cast<int>(rotations.size()));
            debugInfo->set("rawScaleCount", static_cast<int>(scales.size()));
            debugInfo->set("rawTransformCount", static_cast<int>(transformCount));
        }
        if (transformCount == 0) {
            return false;
        }

        if (translations.size() != transformCount) {
            translations.assign(transformCount, GfVec3f(0.0f));
        }
        if (rotations.size() != transformCount) {
            rotations.assign(transformCount, GfQuatf(1.0f));
        }
        if (scales.size() != transformCount) {
            scales.assign(transformCount, GfVec3h(1.0f));
        }
        if (animJointOrder.empty()) {
            animJointOrder = skelQuery.GetJointOrder();
        }

        animLocalTransforms.resize(translations.size());
        if (!UsdSkelMakeTransforms(
                translations,
                rotations,
                scales,
                &animLocalTransforms)) {
            return false;
        }
    }
    if (debugInfo) {
        debugInfo->set("usedAnimQueryTransforms", animQueryComputed);
        debugInfo->set("animJointOrderCount", static_cast<int>(animJointOrder.size()));
        debugInfo->set("animLocalTransformCount", static_cast<int>(animLocalTransforms.size()));
    }

    if (animJointOrder.empty() || animLocalTransforms.empty()) {
        return false;
    }

    VtArray<GfMatrix4d> localTransforms;
    if (!skelQuery.ComputeJointLocalTransforms(&localTransforms, timeCode) ||
        localTransforms.empty()) {
        return false;
    }

    VtTokenArray skelJointOrder = skelQuery.GetJointOrder();
    if (skelJointOrder.empty() ||
        animJointOrder.empty() ||
        localTransforms.size() != skelJointOrder.size()) {
        if (debugInfo) {
            debugInfo->set("skelJointOrderCount", static_cast<int>(skelJointOrder.size()));
            debugInfo->set("seedLocalTransformCount", static_cast<int>(localTransforms.size()));
        }
        return false;
    }

    UsdSkelAnimMapper animToSkelMapper(animJointOrder, skelJointOrder);
    if (debugInfo) {
        debugInfo->set("inferredAnimMapperIsNull", animToSkelMapper.IsNull());
        debugInfo->set("inferredAnimMapperIsSparse", animToSkelMapper.IsSparse());
    }
    if (animToSkelMapper.IsNull()) {
        return false;
    }
    if (!animToSkelMapper.RemapTransforms(animLocalTransforms, &localTransforms)) {
        if (debugInfo) {
            debugInfo->set("inferredAnimMapperRemapFailed", true);
        }
        return false;
    }

    VtArray<GfMatrix4d> jointSkelTransforms;
    jointSkelTransforms.resize(localTransforms.size());
    if (!UsdSkelConcatJointTransforms(
            skelQuery.GetTopology(),
            localTransforms,
            jointSkelTransforms)) {
        if (debugInfo) {
            debugInfo->set("concatFailed", true);
            debugInfo->set("localTransformCount", static_cast<int>(localTransforms.size()));
        }
        return false;
    }

    VtArray<GfMatrix4d> bindTransforms;
    if (!skelQuery.GetJointWorldBindTransforms(&bindTransforms) ||
        bindTransforms.size() != jointSkelTransforms.size()) {
        if (debugInfo) {
            debugInfo->set("bindTransformCount", static_cast<int>(bindTransforms.size()));
            debugInfo->set("jointSkelTransformCount", static_cast<int>(jointSkelTransforms.size()));
        }
        return false;
    }

    skinningTransforms->resize(jointSkelTransforms.size());
    for (size_t index = 0; index < jointSkelTransforms.size(); ++index) {
        (*skinningTransforms)[index] =
            bindTransforms[index].GetInverse() * jointSkelTransforms[index];
    }
    return true;
}

int
_AuthorLegacySkelBindingTargets(
    const UsdStageRefPtr& stage,
    LegacySkelBindingAuthoringDiagnostics* diagnostics)
{
    if (!stage) {
        return 0;
    }

    static const TfToken kSkeletonType("Skeleton");

    SdfLayerHandle sessionLayer = stage->GetSessionLayer();
    if (!sessionLayer) {
        return 0;
    }

    UsdSkelCache skinningQueryCache;
    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot())) {
        if (prim.IsA<UsdSkelRoot>()) {
            skinningQueryCache.Populate(
                UsdSkelRoot(prim),
                UsdTraverseInstanceProxies());
        }
    }

    int authoredCount = 0;
    UsdEditContext editContext(
        stage,
        stage->GetEditTargetForLocalLayer(sessionLayer));

    auto getOrCreateRelSpec = [&](const SdfPath& primPath, const TfToken& relName) {
        SdfPrimSpecHandle primSpec =
            _EnsurePrimSpecInLayer(sessionLayer, primPath);
        if (!primSpec) {
            return SdfRelationshipSpecHandle();
        }
        SdfRelationshipSpecHandle relSpec =
            primSpec->GetRelationships()[relName.GetString()];
        if (!relSpec) {
            relSpec = SdfRelationshipSpec::New(
                primSpec,
                relName.GetString(),
                /* custom = */ false,
                SdfVariabilityVarying);
        }
        return relSpec;
    };

    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot())) {
        if (prim.GetTypeName() == kSkeletonType) {
            if (diagnostics) {
                ++diagnostics->skeletonPrims;
            }
            UsdPrim animation = _InferAnimationForSkeleton(prim);
            if (!animation) {
                continue;
            }
            if (diagnostics) {
                ++diagnostics->animationTargets;
            }

            SdfRelationshipSpecHandle relSpec = getOrCreateRelSpec(
                prim.GetPath(),
                UsdSkelTokens->skelAnimationSource);
            if (relSpec) {
                if (diagnostics) {
                    ++diagnostics->relationshipSpecs;
                }
                relSpec->GetTargetPathList().GetExplicitItems() = {
                    animation.GetPath()
                };
                ++authoredCount;
            }
            continue;
        }

        if (!prim.IsA<UsdGeomMesh>() ||
            !skinningQueryCache.GetSkinningQuery(prim)) {
            if (prim.IsA<UsdGeomMesh>() && diagnostics) {
                ++diagnostics->meshPrims;
            }
            continue;
        }
        if (diagnostics) {
            ++diagnostics->meshPrims;
            ++diagnostics->meshSkinningQueries;
        }

        UsdPrim skeleton = _InferSkeletonForSkelBoundPrim(prim);
        if (!skeleton) {
            continue;
        }
        if (diagnostics) {
            ++diagnostics->meshInferredSkeletons;
        }

        SdfRelationshipSpecHandle relSpec = getOrCreateRelSpec(
            prim.GetPath(),
            UsdSkelTokens->skelSkeleton);
        if (relSpec) {
            if (diagnostics) {
                ++diagnostics->relationshipSpecs;
            }
            relSpec->GetTargetPathList().GetExplicitItems() = {
                skeleton.GetPath()
            };
            ++authoredCount;
        }
    }

    return authoredCount;
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
_ExtractMeshPayload(
    const UsdGeomMesh& mesh,
    MeshPayload* payload,
    UsdTimeCode timeCode,
    const UsdSkelCache* skelCache,
    const UsdSkelSkeleton& skel,
    UsdGeomXformCache* xformCache)
{
    VtArray<GfVec3f> usdPoints;
    VtArray<int> faceVertexCounts;
    VtArray<int> faceVertexIndices;

    if (!mesh.GetPointsAttr().Get(&usdPoints, timeCode) ||
        !mesh.GetFaceVertexCountsAttr().Get(&faceVertexCounts) ||
        !mesh.GetFaceVertexIndicesAttr().Get(&faceVertexIndices) ||
        usdPoints.empty() ||
        faceVertexCounts.empty() ||
        faceVertexIndices.empty()) {
        return false;
    }

    if (skelCache && skel && xformCache) {
        const UsdPrim meshPrim = mesh.GetPrim();
        if (UsdSkelSkinningQuery skinningQuery = skelCache->GetSkinningQuery(meshPrim)) {
            if (UsdSkelSkeletonQuery skelQuery = skelCache->GetSkelQuery(skel)) {
                VtArray<GfMatrix4d> skinningTransforms;
                skelQuery.ComputeSkinningTransforms(&skinningTransforms, timeCode);
                if (!skelQuery.GetAnimQuery()) {
                    _ComputeInferredSkinningTransforms(
                        skelCache,
                        skel,
                        timeCode,
                        &skinningTransforms);
                }
                if (!skinningTransforms.empty()) {
                    VtArray<GfVec3f> skinnedPoints = usdPoints;
                    if (skinningQuery.ComputeSkinnedPoints(
                            skinningTransforms,
                            &skinnedPoints,
                            timeCode)) {
                            const GfMatrix4d skelLocalToWorld =
                                xformCache->GetLocalToWorldTransform(skel.GetPrim());
                            const GfMatrix4d gprimLocalToWorld =
                                xformCache->GetLocalToWorldTransform(meshPrim);
                            const GfMatrix4d skelToGprim =
                                skelLocalToWorld * gprimLocalToWorld.GetInverse();
                            for (GfVec3f& point : skinnedPoints) {
                                point = GfVec3f(skelToGprim.Transform(point));
                            }
                            usdPoints = skinnedPoints;
                    }
                }
            }
        }
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
static std::unordered_map<std::string, std::unique_ptr<UsdSkelCache>> g_skelCache;
static std::unordered_map<std::string, bool> g_stageHasSkelRoot;
static std::unordered_map<std::string, std::unordered_map<std::string, UsdSkelSkeleton>>
    g_skinningSkeletonByStageAndPrim;
static std::unordered_map<std::string, int> g_authoredLegacySkelBindingTargets;
static std::unordered_map<std::string, LegacySkelBindingAuthoringDiagnostics>
    g_legacySkelBindingAuthoringDiagnostics;

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

void
_InvalidateDerivedStageCaches(const std::string& path)
{
    g_skelCache.erase(path);
    g_stageHasSkelRoot.erase(path);
    g_skinningSkeletonByStageAndPrim.erase(path);
    g_hydraAnimationDrivers.erase(path);
    g_authoredLegacySkelBindingTargets.erase(path);
    g_legacySkelBindingAuthoringDiagnostics.erase(path);
}

UsdSkelCache*
_GetOrPopulateSkelCache(const std::string& path, const UsdStageRefPtr& stage)
{
    if (g_authoredLegacySkelBindingTargets.find(path) ==
        g_authoredLegacySkelBindingTargets.end()) {
        LegacySkelBindingAuthoringDiagnostics diagnostics;
        g_authoredLegacySkelBindingTargets[path] =
            _AuthorLegacySkelBindingTargets(stage, &diagnostics);
        g_legacySkelBindingAuthoringDiagnostics[path] = diagnostics;
    }

    auto hasIt = g_stageHasSkelRoot.find(path);
    if (hasIt != g_stageHasSkelRoot.end() && !hasIt->second) {
        return nullptr;
    }

    auto cacheIt = g_skelCache.find(path);
    if (cacheIt != g_skelCache.end()) {
        return cacheIt->second.get();
    }

    auto cache = std::make_unique<UsdSkelCache>();
    auto& skeletonByPrim = g_skinningSkeletonByStageAndPrim[path];
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

    g_stageHasSkelRoot[path] = hasSkelRoot;
    if (!hasSkelRoot) {
        return nullptr;
    }

    UsdSkelCache* result = cache.get();
    g_skelCache[path] = std::move(cache);
    return result;
}

UsdSkelSkeleton
_FindSkeletonForSkinnedPrim(const std::string& stagePath, const UsdPrim& prim)
{
    auto stageIt = g_skinningSkeletonByStageAndPrim.find(stagePath);
    if (stageIt == g_skinningSkeletonByStageAndPrim.end()) {
        return UsdSkelSkeleton();
    }
    auto primIt = stageIt->second.find(prim.GetPath().GetString());
    if (primIt != stageIt->second.end()) {
        return primIt->second;
    }

    UsdPrim skeleton = _InferSkeletonForSkelBoundPrim(prim);
    return skeleton ? UsdSkelSkeleton(skeleton) : UsdSkelSkeleton();
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
    UsdStageRefPtr stage = _GetOrOpenStage(stagePath);
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

double
_MaxMatrixDelta(const VtArray<GfMatrix4d>& a, const VtArray<GfMatrix4d>& b)
{
    double maxDelta = 0.0;
    const size_t count = std::min(a.size(), b.size());
    for (size_t matrixIndex = 0; matrixIndex < count; ++matrixIndex) {
        for (int row = 0; row < 4; ++row) {
            for (int col = 0; col < 4; ++col) {
                maxDelta = std::max(
                    maxDelta,
                    std::abs(a[matrixIndex][row][col] - b[matrixIndex][row][col]));
            }
        }
    }
    return maxDelta;
}

emscripten::val
GetSkelDebugInfo(
    const std::string& stagePath,
    const std::string& primPath,
    double timeA,
    double timeB)
{
    emscripten::val info = emscripten::val::object();
    UsdStageRefPtr stage = _GetOrOpenStage(stagePath);
    info.set("stageOpened", static_cast<bool>(stage));
    if (!stage) {
        return info;
    }

    UsdPrim prim = stage->GetPrimAtPath(SdfPath(primPath));
    info.set("primFound", static_cast<bool>(prim));
    if (!prim) {
        return info;
    }

    info.set("primType", prim.GetTypeName().GetString());
    info.set("hasBindingApi", prim.HasAPI<UsdSkelBindingAPI>());

    UsdSkelBindingAPI binding(prim);
    UsdSkelSkeleton directSkeleton;
    const bool hasDirectSkeleton = binding.GetSkeleton(&directSkeleton);
    info.set("hasDirectSkeletonResult", hasDirectSkeleton);
    info.set("directSkeletonPath", directSkeleton
        ? directSkeleton.GetPrim().GetPath().GetString()
        : std::string());

    UsdSkelSkeleton inheritedSkeleton = binding.GetInheritedSkeleton();
    info.set("inheritedSkeletonPath", inheritedSkeleton
        ? inheritedSkeleton.GetPrim().GetPath().GetString()
        : std::string());

    UsdSkelCache* skelCache = _GetOrPopulateSkelCache(stagePath, stage);
    info.set("hasSkelCache", skelCache != nullptr);
    auto authoredIt = g_authoredLegacySkelBindingTargets.find(stagePath);
    info.set(
        "authoredLegacySkelBindingTargetCount",
        authoredIt == g_authoredLegacySkelBindingTargets.end()
            ? 0
            : authoredIt->second);
    auto authoringDiagIt =
        g_legacySkelBindingAuthoringDiagnostics.find(stagePath);
    if (authoringDiagIt != g_legacySkelBindingAuthoringDiagnostics.end()) {
        const LegacySkelBindingAuthoringDiagnostics& diag =
            authoringDiagIt->second;
        info.set("legacyAuthorSkeletonPrims", diag.skeletonPrims);
        info.set("legacyAuthorAnimationTargets", diag.animationTargets);
        info.set("legacyAuthorMeshPrims", diag.meshPrims);
        info.set("legacyAuthorMeshSkinningQueries", diag.meshSkinningQueries);
        info.set("legacyAuthorMeshInferredSkeletons", diag.meshInferredSkeletons);
        info.set("legacyAuthorRelationshipSpecs", diag.relationshipSpecs);
    }
    int skelRootCount = 0;
    int skelBindingCount = 0;
    int skelBindingTargetCount = 0;
    if (skelCache) {
        for (const UsdPrim& skelRootPrim : UsdPrimRange(stage->GetPseudoRoot())) {
            if (!skelRootPrim.IsA<UsdSkelRoot>()) {
                continue;
            }
            ++skelRootCount;
            std::vector<UsdSkelBinding> bindings;
            if (skelCache->ComputeSkelBindings(
                    UsdSkelRoot(skelRootPrim),
                    &bindings,
                    UsdTraverseInstanceProxies())) {
                skelBindingCount += static_cast<int>(bindings.size());
                for (const UsdSkelBinding& binding : bindings) {
                    skelBindingTargetCount +=
                        static_cast<int>(binding.GetSkinningTargets().size());
                }
            }
        }
    }
    info.set("skelRootCount", skelRootCount);
    info.set("skelBindingCount", skelBindingCount);
    info.set("skelBindingTargetCount", skelBindingTargetCount);
    UsdSkelSkeleton mappedSkeleton = _FindSkeletonForSkinnedPrim(stagePath, prim);
    info.set("mappedSkeletonPath", mappedSkeleton
        ? mappedSkeleton.GetPrim().GetPath().GetString()
        : std::string());

    if (!skelCache) {
        return info;
    }

    if (UsdSkelSkinningQuery skinningQuery = skelCache->GetSkinningQuery(prim)) {
        info.set("hasSkinningQuery", true);
        info.set("hasBlendShapes", skinningQuery.HasBlendShapes());
        info.set(
            "numInfluencesPerComponent",
            skinningQuery.GetNumInfluencesPerComponent());
        VtTokenArray skinningJointOrder;
        if (skinningQuery.GetJointOrder(&skinningJointOrder)) {
            info.set(
                "skinningJointOrderCount",
                static_cast<int>(skinningJointOrder.size()));
        }
        VtTokenArray blendShapeOrder;
        if (skinningQuery.GetBlendShapeOrder(&blendShapeOrder)) {
            info.set(
                "blendShapeOrderCount",
                static_cast<int>(blendShapeOrder.size()));
        }
        VtArray<int> jointIndices;
        VtArray<float> jointWeights;
        const bool hasInfluences = skinningQuery.ComputeJointInfluences(
            &jointIndices,
            &jointWeights,
            UsdTimeCode(timeA));
        info.set("hasJointInfluences", hasInfluences);
        info.set("jointIndexCount", static_cast<int>(jointIndices.size()));
        info.set("jointWeightCount", static_cast<int>(jointWeights.size()));
    } else {
        info.set("hasSkinningQuery", false);
    }

    UsdSkelSkeleton skeleton =
        mappedSkeleton ? mappedSkeleton :
        inheritedSkeleton ? inheritedSkeleton :
        directSkeleton;
    info.set("debugSkeletonPath", skeleton
        ? skeleton.GetPrim().GetPath().GetString()
        : std::string());

    if (!skeleton) {
        return info;
    }

    UsdPrim animationPrim;
    UsdSkelBindingAPI(skeleton.GetPrim()).GetAnimationSource(&animationPrim);
    info.set("animationSourcePath", animationPrim
        ? animationPrim.GetPath().GetString()
        : std::string());

    UsdSkelSkeletonQuery skelQuery = skelCache->GetSkelQuery(skeleton);
    info.set("hasSkeletonQuery", static_cast<bool>(skelQuery));
    if (!skelQuery) {
        return info;
    }

    const UsdSkelAnimQuery& animQuery = skelQuery.GetAnimQuery();
    info.set("animQueryPath", animQuery
        ? animQuery.GetPrim().GetPath().GetString()
        : std::string());

    VtArray<GfMatrix4d> localA;
    VtArray<GfMatrix4d> localB;
    VtArray<GfMatrix4d> skinA;
    VtArray<GfMatrix4d> skinB;
    info.set(
        "localAComputed",
        skelQuery.ComputeJointLocalTransforms(&localA, UsdTimeCode(timeA)));
    info.set(
        "localBComputed",
        skelQuery.ComputeJointLocalTransforms(&localB, UsdTimeCode(timeB)));
    info.set("localJointCountA", static_cast<int>(localA.size()));
    info.set("localJointCountB", static_cast<int>(localB.size()));
    info.set("localMaxDelta", _MaxMatrixDelta(localA, localB));

    info.set(
        "skinAComputed",
        skelQuery.ComputeSkinningTransforms(&skinA, UsdTimeCode(timeA)));
    info.set(
        "skinBComputed",
        skelQuery.ComputeSkinningTransforms(&skinB, UsdTimeCode(timeB)));
    info.set("skinJointCountA", static_cast<int>(skinA.size()));
    info.set("skinJointCountB", static_cast<int>(skinB.size()));
    info.set("skinMaxDelta", _MaxMatrixDelta(skinA, skinB));

    VtArray<GfMatrix4d> inferredSkinA;
    VtArray<GfMatrix4d> inferredSkinB;
    info.set(
        "inferredSkinAComputed",
        _ComputeInferredSkinningTransforms(
            skelCache,
            skeleton,
            UsdTimeCode(timeA),
            &inferredSkinA,
            &info));
    info.set(
        "inferredSkinBComputed",
        _ComputeInferredSkinningTransforms(
            skelCache,
            skeleton,
            UsdTimeCode(timeB),
            &inferredSkinB));
    info.set("inferredSkinJointCountA", static_cast<int>(inferredSkinA.size()));
    info.set("inferredSkinJointCountB", static_cast<int>(inferredSkinB.size()));
    info.set("inferredSkinMaxDelta", _MaxMatrixDelta(inferredSkinA, inferredSkinB));

    return info;
}

emscripten::val
_ExtractRenderablesAtTime(const std::string& path, UsdTimeCode timeCode, bool includeMaterials)
{
    emscripten::val renderables = emscripten::val::array();
    UsdStageRefPtr stage = _GetOrOpenStage(path);
    if (!stage) {
        return renderables;
    }

    UsdGeomXformCache xformCache(timeCode);
    UsdShadeMaterialBindingAPI::BindingsCache bindingsCache;
    UsdShadeMaterialBindingAPI::CollectionQueryCache collectionQueryCache;
    UsdSkelCache* skelCache = _GetOrPopulateSkelCache(path, stage);

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
        if (!_ExtractMeshPayload(
                mesh,
                &payload,
                timeCode,
                skelCache,
                _FindSkeletonForSkinnedPrim(path, prim),
                &xformCache)) {
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
        if (includeMaterials) {
            renderable.set(
                "material",
                _ExtractMaterial(
                    prim,
                    packageRootPath,
                    &bindingsCache,
                    &collectionQueryCache,
                    renderable["color"]));
        }
        renderables.set(renderableIndex++, renderable);
    }

    return renderables;
}

emscripten::val
ExtractRenderables(const std::string& path)
{
    UsdStageRefPtr stage = _GetOrOpenStage(path);
    return _ExtractRenderablesAtTime(
        path,
        stage ? UsdTimeCode(stage->GetStartTimeCode()) : UsdTimeCode::Default(),
        false);
}

emscripten::val
ExtractRenderablesWithMaterials(const std::string& path)
{
    UsdStageRefPtr stage = _GetOrOpenStage(path);
    return _ExtractRenderablesAtTime(
        path,
        stage ? UsdTimeCode(stage->GetStartTimeCode()) : UsdTimeCode::Default(),
        true);
}

emscripten::val
ExtractRenderablesAtTime(const std::string& path, double timeCode)
{
    return _ExtractRenderablesAtTime(path, UsdTimeCode(timeCode), false);
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
    _InvalidateDerivedStageCaches(stagePath);

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
    _InvalidateDerivedStageCaches(stagePath);
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
    _InvalidateDerivedStageCaches(stagePath);
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
    _InvalidateDerivedStageCaches(stagePath);
}

emscripten::val
ExtractGaussianSplats(const std::string& path)
{
    emscripten::val result = emscripten::val::array();
    UsdStageRefPtr stage = _GetOrOpenStage(path);
    if (!stage) return result;

    UsdGeomXformCache xformCache(stage->GetStartTimeCode());
    size_t splatIndex = 0;

    static const TfToken kType("ParticleField3DGaussianSplat");
    static const TfToken kPositions("positions");
    static const TfToken kPositionsH("positionsh");
    static const TfToken kScales("scales");
    static const TfToken kScalesH("scalesh");
    static const TfToken kOrientations("orientations");
    static const TfToken kOrientationsH("orientationsh");
    static const TfToken kOpacities("opacities");
    static const TfToken kOpacitiesH("opacitiesh");
    static const TfToken kSHCoeffs("radiance:sphericalHarmonicsCoefficients");
    static const TfToken kSHDegree("radiance:sphericalHarmonicsDegree");

    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot())) {
        if (prim.GetTypeName() != kType) {
            continue;
        }

        // --- Positions ---
        std::vector<float> posOut;
        {
            VtArray<GfVec3f> arr;
            if (prim.GetAttribute(kPositions).Get(&arr) && !arr.empty()) {
                posOut.reserve(arr.size() * 3);
                for (const auto& v : arr) {
                    posOut.push_back(v[0]);
                    posOut.push_back(v[1]);
                    posOut.push_back(v[2]);
                }
            } else {
                VtArray<GfVec3h> arrh;
                if (prim.GetAttribute(kPositionsH).Get(&arrh) && !arrh.empty()) {
                    posOut.reserve(arrh.size() * 3);
                    for (const auto& v : arrh) {
                        posOut.push_back(static_cast<float>(v[0]));
                        posOut.push_back(static_cast<float>(v[1]));
                        posOut.push_back(static_cast<float>(v[2]));
                    }
                }
            }
        }
        if (posOut.empty()) continue;
        const size_t count = posOut.size() / 3;

        // --- Scales ---
        std::vector<float> scaleOut;
        {
            VtArray<GfVec3f> arr;
            if (prim.GetAttribute(kScales).Get(&arr) && !arr.empty()) {
                scaleOut.reserve(arr.size() * 3);
                for (const auto& v : arr) {
                    scaleOut.push_back(v[0]);
                    scaleOut.push_back(v[1]);
                    scaleOut.push_back(v[2]);
                }
            } else {
                VtArray<GfVec3h> arrh;
                if (prim.GetAttribute(kScalesH).Get(&arrh) && !arrh.empty()) {
                    scaleOut.reserve(arrh.size() * 3);
                    for (const auto& v : arrh) {
                        scaleOut.push_back(static_cast<float>(v[0]));
                        scaleOut.push_back(static_cast<float>(v[1]));
                        scaleOut.push_back(static_cast<float>(v[2]));
                    }
                }
            }
        }

        // --- Orientations → [x, y, z, w] per splat ---
        std::vector<float> orientOut;
        {
            VtArray<GfQuatf> arr;
            if (prim.GetAttribute(kOrientations).Get(&arr) && !arr.empty()) {
                orientOut.reserve(arr.size() * 4);
                for (const auto& q : arr) {
                    orientOut.push_back(q.GetImaginary()[0]);
                    orientOut.push_back(q.GetImaginary()[1]);
                    orientOut.push_back(q.GetImaginary()[2]);
                    orientOut.push_back(q.GetReal());
                }
            } else {
                VtArray<GfQuath> arrh;
                if (prim.GetAttribute(kOrientationsH).Get(&arrh) && !arrh.empty()) {
                    orientOut.reserve(arrh.size() * 4);
                    for (const auto& q : arrh) {
                        orientOut.push_back(static_cast<float>(q.GetImaginary()[0]));
                        orientOut.push_back(static_cast<float>(q.GetImaginary()[1]));
                        orientOut.push_back(static_cast<float>(q.GetImaginary()[2]));
                        orientOut.push_back(static_cast<float>(q.GetReal()));
                    }
                }
            }
        }

        // --- Opacities ---
        std::vector<float> opacOut;
        {
            VtArray<float> arr;
            if (prim.GetAttribute(kOpacities).Get(&arr) && !arr.empty()) {
                opacOut.assign(arr.begin(), arr.end());
            } else {
                VtArray<GfHalf> arrh;
                if (prim.GetAttribute(kOpacitiesH).Get(&arrh) && !arrh.empty()) {
                    opacOut.reserve(arrh.size());
                    for (const auto& h : arrh) {
                        opacOut.push_back(static_cast<float>(h));
                    }
                }
            }
        }

        // --- SH Coefficients (all degrees, stored as count*coeffsPerSplat vec3fs) ---
        std::vector<float> shOut;
        int shDegree = 0;
        {
            VtArray<GfVec3f> arr;
            if (prim.GetAttribute(kSHCoeffs).Get(&arr) && !arr.empty()) {
                shOut.reserve(arr.size() * 3);
                for (const auto& v : arr) {
                    shOut.push_back(v[0]);
                    shOut.push_back(v[1]);
                    shOut.push_back(v[2]);
                }
                // Infer degree from total coefficient count
                const size_t coeffsPerSplat = arr.size() / count;
                for (int d = 0; d <= 3; ++d) {
                    if (static_cast<size_t>((d + 1) * (d + 1)) == coeffsPerSplat) {
                        shDegree = d;
                        break;
                    }
                }
            }
            // Authored degree overrides inferred one
            int authoredDegree = 0;
            if (prim.GetAttribute(kSHDegree).Get(&authoredDegree)) {
                shDegree = authoredDegree;
            }
        }

        emscripten::val entry = emscripten::val::object();
        entry.set("path", prim.GetPath().GetString());
        entry.set("name", prim.GetName().GetString());
        entry.set("count", static_cast<int>(count));
        entry.set("matrix", _MatrixArray(xformCache.GetLocalToWorldTransform(prim)));
        entry.set("positions", _Float32Array(posOut));
        entry.set("scales", _Float32Array(scaleOut));
        entry.set("orientations", _Float32Array(orientOut));
        entry.set("opacities", _Float32Array(opacOut));
        if (!shOut.empty()) {
            entry.set("shCoeffs", _Float32Array(shOut));
            entry.set("shDegree", shDegree);
        }
        result.set(splatIndex++, entry);
    }

    return result;
}

HydraAnimationDriver*
_GetOrCreateHydraAnimationDriver(const std::string& stagePath)
{
    auto it = g_hydraAnimationDrivers.find(stagePath);
    if (it != g_hydraAnimationDrivers.end()) {
        return it->second.get();
    }

    UsdStageRefPtr stage = _GetOrOpenStage(stagePath);
    if (!stage) {
        return nullptr;
    }

    g_skelCache.erase(stagePath);
    g_stageHasSkelRoot.erase(stagePath);
    g_skinningSkeletonByStageAndPrim.erase(stagePath);
    _GetOrPopulateSkelCache(stagePath, stage);
    auto driver = std::make_unique<HydraAnimationDriver>(stagePath, stage);
    HydraAnimationDriver* ptr = driver.get();
    g_hydraAnimationDrivers[stagePath] = std::move(driver);
    return ptr;
}

bool
_ExpandHydraUpdateToFaceVertices(
    const UsdStageRefPtr& stage,
    SdfPath const& primPath,
    UsdTimeCode timeCode,
    HydraMeshUpdate* update)
{
    if (!stage || !update || update->points.empty()) {
        return false;
    }

    UsdPrim prim = stage->GetPrimAtPath(primPath);
    if (!prim || !prim.IsA<UsdGeomMesh>()) {
        return false;
    }

    UsdGeomMesh mesh(prim);
    VtArray<int> faceVertexCounts;
    VtArray<int> faceVertexIndices;
    if (!mesh.GetFaceVertexCountsAttr().Get(&faceVertexCounts) ||
        !mesh.GetFaceVertexIndicesAttr().Get(&faceVertexIndices) ||
        faceVertexCounts.empty() ||
        faceVertexIndices.empty()) {
        return false;
    }

    const size_t pointCount = update->points.size() / 3;
    VtArray<GfVec2f> uvValues;
    TfToken uvInterpolation;
    UsdGeomPrimvar stPrimvar = UsdGeomPrimvarsAPI(mesh).GetPrimvar(TfToken("st"));
    const bool hasUvValues =
        stPrimvar &&
        stPrimvar.ComputeFlattened(&uvValues, timeCode) &&
        !uvValues.empty();
    if (hasUvValues) {
        uvInterpolation = stPrimvar.GetInterpolation();
    }

    std::vector<float> expandedPoints;
    std::vector<float> expandedUvs;
    std::vector<int> expandedIndices;
    expandedPoints.reserve(faceVertexIndices.size() * 3);
    expandedIndices.reserve(faceVertexIndices.size());
    if (hasUvValues) {
        expandedUvs.reserve(faceVertexIndices.size() * 2);
    }

    auto appendVertex = [&](size_t faceVertexOffset) {
        const int pointIndex = faceVertexIndices[faceVertexOffset];
        if (pointIndex < 0 || static_cast<size_t>(pointIndex) >= pointCount) {
            return false;
        }

        const size_t pointOffset = static_cast<size_t>(pointIndex) * 3;
        expandedPoints.push_back(update->points[pointOffset]);
        expandedPoints.push_back(update->points[pointOffset + 1]);
        expandedPoints.push_back(update->points[pointOffset + 2]);
        expandedIndices.push_back(static_cast<int>((expandedPoints.size() / 3) - 1));

        if (hasUvValues) {
            GfVec2f uv(0.0f, 0.0f);
            if (_GetUvForFaceVertex(
                    uvValues,
                    uvInterpolation,
                    faceVertexOffset,
                    pointIndex,
                    &uv)) {
                expandedUvs.push_back(uv[0]);
                expandedUvs.push_back(uv[1]);
            }
        }

        return true;
    };

    size_t offset = 0;
    for (int faceVertexCount : faceVertexCounts) {
        if (faceVertexCount < 3 ||
            offset + static_cast<size_t>(faceVertexCount) > faceVertexIndices.size()) {
            offset += std::max(faceVertexCount, 0);
            continue;
        }

        for (int i = 1; i < faceVertexCount - 1; ++i) {
            if (!appendVertex(offset) ||
                !appendVertex(offset + i) ||
                !appendVertex(offset + i + 1)) {
                return false;
            }
        }

        offset += faceVertexCount;
    }

    if (expandedPoints.empty() || expandedIndices.empty()) {
        return false;
    }

    if (expandedUvs.size() != (expandedPoints.size() / 3) * 2) {
        expandedUvs.clear();
    }

    update->points = std::move(expandedPoints);
    update->triangleIndices = std::move(expandedIndices);
    update->uvs = std::move(expandedUvs);
    return true;
}

emscripten::val
ExtractHydraRenderablesAtTime(const std::string& stagePath, double timeCode)
{
    emscripten::val result = emscripten::val::array();
    HydraAnimationDriver* driver = _GetOrCreateHydraAnimationDriver(stagePath);
    if (!driver || !driver->renderIndex || !driver->imagingDelegate) {
        return result;
    }

    driver->collector.Clear();
    driver->imagingDelegate->SetTime(UsdTimeCode(timeCode));
    driver->imagingDelegate->ApplyPendingUpdates();
    driver->imagingDelegate->SyncAll(true);

    UsdSkelCache* skelCache = _GetOrPopulateSkelCache(stagePath, driver->stage);
    UsdGeomXformCache xformCache{UsdTimeCode(timeCode)};

    for (SdfPath const& id : driver->renderIndex->GetRprimIds()) {
        UsdPrim prim = driver->stage->GetPrimAtPath(id);
        if (!prim || !prim.IsA<UsdGeomMesh>()) {
            continue;
        }

        HydraMeshUpdate update;
        if (_BuildHydraMeshUpdate(
                driver->renderIndex.get(),
                id,
                &update,
                std::numeric_limits<float>::epsilon())) {
            if (!update.usedComputedPoints && skelCache) {
                MeshPayload payload;
                if (_ExtractMeshPayload(
                        UsdGeomMesh(prim),
                        &payload,
                        UsdTimeCode(timeCode),
                        skelCache,
                        _FindSkeletonForSkinnedPrim(stagePath, prim),
                        &xformCache)) {
                    update.usdSkelFallbackAvailable = true;
                }
            }
            _ExpandHydraUpdateToFaceVertices(
                driver->stage,
                id,
                UsdTimeCode(timeCode),
                &update);
            driver->collector.Record(std::move(update));
        }
    }

    size_t index = 0;
    for (const auto& entry : driver->collector.updates) {
        const HydraMeshUpdate& update = entry.second;
        emscripten::val renderable = emscripten::val::object();
        renderable.set("path", update.path);
        renderable.set("name", update.name);
        renderable.set("points", _FloatArray(update.points));
        renderable.set("indices", _IntArray(update.triangleIndices));
        if (!update.uvs.empty()) {
            renderable.set("uvs", _FloatArray(update.uvs));
        }
        renderable.set("matrix", _MatrixArray(update.matrix));
        renderable.set("pointComputationCount", update.pointComputationCount);
        renderable.set("sceneIndexChildCount", update.sceneIndexChildCount);
        renderable.set("sceneIndexHasSkelRoot", update.sceneIndexHasSkelRoot);
        renderable.set("sceneIndexSkeletonPath", update.sceneIndexSkeletonPath);
        renderable.set("sceneIndexAnimationSourcePath", update.sceneIndexAnimationSourcePath);
        renderable.set("sceneIndexAnimationPrimType", update.sceneIndexAnimationPrimType);
        renderable.set("sceneIndexAnimationJointCount", update.sceneIndexAnimationJointCount);
        renderable.set("sceneIndexAnimationTranslationCount", update.sceneIndexAnimationTranslationCount);
        renderable.set("sceneIndexAnimationTranslationSum", update.sceneIndexAnimationTranslationSum);
        renderable.set("sceneIndexAnimationRotationCount", update.sceneIndexAnimationRotationCount);
        renderable.set("sceneIndexAnimationRotationSum", update.sceneIndexAnimationRotationSum);
        renderable.set("sceneIndexAnimationScaleCount", update.sceneIndexAnimationScaleCount);
        renderable.set("sceneIndexAnimationScaleSum", update.sceneIndexAnimationScaleSum);
        renderable.set("sceneIndexSkinningTransformCount", update.sceneIndexSkinningTransformCount);
        renderable.set("sceneIndexSkinningTransformSum", update.sceneIndexSkinningTransformSum);
        renderable.set("sceneIndexSkinningTransformWeightedSum", update.sceneIndexSkinningTransformWeightedSum);
        renderable.set("hydraCreatedMeshRprimCount", driver->collector.diagnostics.createdMeshRprims);
        renderable.set("hydraCreatedExtComputationCount", driver->collector.diagnostics.createdExtComputations);
        renderable.set("hydraCreatedMaterialCount", driver->collector.diagnostics.createdMaterials);
        renderable.set("usedComputedPoints", update.usedComputedPoints);
        renderable.set("usdSkelFallbackAvailable", update.usdSkelFallbackAvailable);
        result.set(index++, renderable);
    }

    return result;
}

EMSCRIPTEN_BINDINGS(usdWebViewBindings)
{
    emscripten::function("InitializeRuntime", &InitializeRuntime);
    emscripten::function("GetRuntimeDiagnostics", &GetRuntimeDiagnostics);
    emscripten::function("InspectPrimRelationships", &InspectPrimRelationships);
    emscripten::function("GetSkelDebugInfo", &GetSkelDebugInfo);
    emscripten::function("ExtractRenderables", &ExtractRenderables);
    emscripten::function("ExtractRenderablesWithMaterials", &ExtractRenderablesWithMaterials);
    emscripten::function("ExtractRenderablesAtTime", &ExtractRenderablesAtTime);
    emscripten::function("ExtractHydraRenderablesAtTime", &ExtractHydraRenderablesAtTime);
    emscripten::function("ExtractTransformsAtTime", &ExtractTransformsAtTime);
    emscripten::function("OpenStage", &OpenStage);
    emscripten::function("GetSceneGraph", &GetSceneGraph);
    emscripten::function("GetPrimAttributes", &GetPrimAttributes);
    emscripten::function("ReopenStage", &ReopenStage);
    emscripten::function("SetVariantSelection", &SetVariantSelection);
    emscripten::function("SetPayloadLoaded", &SetPayloadLoaded);
    emscripten::function("SetAllPayloadsLoaded", &SetAllPayloadsLoaded);
    emscripten::function("ExtractGaussianSplats", &ExtractGaussianSplats);
}
