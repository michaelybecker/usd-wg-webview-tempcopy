#include "pxr/pxr.h"

#include "pxr/base/plug/registry.h"
#include "pxr/base/tf/fileUtils.h"
#include "pxr/base/tf/pathUtils.h"
#include "pxr/base/tf/stringUtils.h"
#include "pxr/base/tf/type.h"
#include "pxr/base/vt/array.h"
#include "pxr/base/gf/half.h"
#include "pxr/base/gf/interval.h"
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
#include "pxr/imaging/hd/extComputationPrimvarsSchema.h"
#include "pxr/imaging/hd/extComputationUtils.h"
#include "pxr/imaging/hd/engine.h"
#include "pxr/imaging/hd/filteringSceneIndex.h"
#include "pxr/imaging/hd/instancer.h"
#include "pxr/imaging/hd/light.h"
#include "pxr/imaging/hd/material.h"
#include "pxr/imaging/hd/mesh.h"
#include "pxr/imaging/hd/meshUtil.h"
#include "pxr/imaging/hd/smoothNormals.h"
#include "pxr/imaging/pxOsd/tokens.h"
#include "pxr/imaging/hd/vertexAdjacency.h"
#include "pxr/imaging/hd/overlayContainerDataSource.h"
#include "pxr/imaging/hd/renderDelegate.h"
#include "pxr/imaging/hd/renderIndex.h"
#include "pxr/imaging/hd/renderPass.h"
#include "pxr/imaging/hd/resourceRegistry.h"
#include "pxr/imaging/hd/rprimCollection.h"
#include "pxr/imaging/hd/sceneIndexAdapterSceneDelegate.h"
#include "pxr/imaging/hd/retainedDataSource.h"
#include "pxr/imaging/hd/tokens.h"
#include "pxr/imaging/hd/unitTestNullRenderPass.h"
#include "pxr/imaging/hdsi/sceneGlobalsSceneIndex.h"
#include "pxr/usd/ar/asset.h"
#include "pxr/usd/ar/definePackageResolver.h"
#include "pxr/usd/ar/packageUtils.h"
#include "pxr/usd/ar/packageResolver.h"
#include "pxr/usd/ar/resolvedPath.h"
#include "pxr/usd/ar/resolver.h"
#include "pxr/usd/sdf/layer.h"
#include "pxr/usd/sdf/path.h"
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
#include "pxr/usd/usdGeom/pointInstancer.h"
#include "pxr/usd/usdGeom/primvar.h"
#include "pxr/usd/usdGeom/primvarsAPI.h"
#include "pxr/usd/usdGeom/subset.h"
#include "pxr/usd/usdGeom/tokens.h"
#include "pxr/usd/usdGeom/xformCache.h"
#include "pxr/usd/usdLux/domeLight.h"
#include "pxr/usd/usdShade/connectableAPI.h"
#include "pxr/usd/usdShade/input.h"
#include "pxr/usd/usdShade/material.h"
#include "pxr/usd/usdShade/materialBindingAPI.h"
#include "pxr/usd/usdShade/shader.h"
#include "pxr/usd/usdShade/tokens.h"
#include "pxr/usd/usdSkel/animQuery.h"
#include "pxr/usd/usdSkel/animMapper.h"
#include "pxr/usd/usdSkel/animation.h"
#include "pxr/usd/usdSkel/bakeSkinning.h"
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
#include <atomic>
#include <cmath>
#include <cstdio>
#include <limits>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <chrono>
#include <set>
#include <deque>
#include <optional>
#include <unordered_map>
#include <vector>

PXR_NAMESPACE_USING_DIRECTIVE

namespace {

struct MeshPayload
{
    std::vector<float> points;
    std::vector<int> triangleIndices;
    std::vector<float> uvs;
    std::vector<int> faceIndexStarts;
    std::vector<int> faceIndexCounts;
};

struct MaterialSubsetGroup
{
    UsdPrim prim;
    int start = 0;
    int count = 0;
};

struct HydraMeshUpdate
{
    std::string path;
    std::string name;
    std::vector<float> points;
    std::vector<int> triangleIndices;
    std::vector<float> uvs;
    bool expandedToFaceVertices = false;
    GfMatrix4d matrix;
    int pointComputationCount = 0;
    int sceneIndexChildCount = 0;
    bool sceneIndexHasSkelRoot = false;
    unsigned dirtyBits = 0;
    bool dirtyPoints = false;
    bool dirtyTransform = false;
    bool dirtyTopology = false;
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
    std::string sceneIndexPrimType;
    int sceneIndexExtComputationPrimvarCount = 0;
    bool sceneIndexHasComputedPointsPrimvar = false;
    std::string sceneIndexComputedPointsSourcePath;
    std::string sceneIndexComputedPointsOutputName;
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
    int relationshipCreateAttempts = 0;
    int relationshipCreateFailures = 0;
    std::string firstRelationshipFailurePath;
    std::string sessionLayerIdentifier;
};

struct UsdaOverlayPrim
{
    std::map<std::string, UsdaOverlayPrim> children;
    std::vector<std::pair<std::string, SdfPath>> relationships;
    bool applySkelBindingAPI = false;
};

std::string
_EscapeUsdaString(const std::string& value)
{
    std::string escaped;
    escaped.reserve(value.size());
    for (const char ch : value) {
        if (ch == '\\' || ch == '"') {
            escaped.push_back('\\');
        }
        escaped.push_back(ch);
    }
    return escaped;
}

std::string
_EscapeUsdaAssetPath(const std::string& value)
{
    std::string escaped;
    escaped.reserve(value.size());
    for (const char ch : value) {
        if (ch == '@') {
            escaped += "@@";
        } else {
            escaped.push_back(ch);
        }
    }
    return escaped;
}

UsdaOverlayPrim*
_GetUsdaOverlayPrim(UsdaOverlayPrim* root, const SdfPath& primPath)
{
    if (!root || !primPath.IsAbsolutePath() || !primPath.IsPrimPath()) {
        return nullptr;
    }

    UsdaOverlayPrim* node = root;
    for (const SdfPath& prefix : primPath.GetPrefixes()) {
        if (prefix == SdfPath::AbsoluteRootPath()) {
            continue;
        }
        node = &node->children[prefix.GetName()];
    }
    return node;
}

void
_AddUsdaOverlayRelationship(
    UsdaOverlayPrim* root,
    const SdfPath& primPath,
    const std::string& relationshipName,
    const SdfPath& targetPath,
    bool applySkelBindingAPI = true)
{
    UsdaOverlayPrim* node = _GetUsdaOverlayPrim(root, primPath);
    if (!node) {
        return;
    }
    if (applySkelBindingAPI) {
        node->applySkelBindingAPI = true;
    }
    for (const auto& existing : node->relationships) {
        if (existing.first == relationshipName && existing.second == targetPath) {
            return;
        }
    }
    node->relationships.push_back({ relationshipName, targetPath });
}

void
_WriteUsdaOverlayPrim(
    std::ostringstream& oss,
    const UsdaOverlayPrim& prim,
    const std::string& name,
    int indent)
{
    const std::string spaces(indent, ' ');
    oss << spaces << "over \"" << _EscapeUsdaString(name) << "\"";
    if (prim.applySkelBindingAPI) {
        oss << " (\n";
        oss << spaces << "    prepend apiSchemas = [\"SkelBindingAPI\"]\n";
        oss << spaces << ")";
    }
    oss << "\n";
    oss << spaces << "{\n";
    for (const auto& relationship : prim.relationships) {
        oss << spaces << "    rel " << relationship.first << " = <"
            << relationship.second.GetString() << ">\n";
    }
    for (const auto& child : prim.children) {
        _WriteUsdaOverlayPrim(oss, child.second, child.first, indent + 4);
    }
    oss << spaces << "}\n";
}

SdfPrimSpecHandle
_EnsurePrimSpecInLayer(const SdfLayerHandle& layer, const SdfPath& primPath)
{
    if (!layer || !primPath.IsAbsolutePath() || !primPath.IsPrimPath()) {
        return SdfPrimSpecHandle();
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

        SdfPrimSpecHandle childSpec = layer->GetPrimAtPath(prefix);
        const std::string name = prefix.GetName();
        if (!childSpec) {
            for (const SdfPrimSpecHandle& child : primSpec->GetNameChildren()) {
                if (child && child->GetName() == name) {
                    childSpec = child;
                    break;
                }
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
    }
    return primSpec;
}

SdfRelationshipSpecHandle
_EnsureRelationshipSpecInLayer(
    const SdfLayerHandle& layer,
    const SdfPath& primPath,
    const TfToken& relationshipName,
    LegacySkelBindingAuthoringDiagnostics* diagnostics = nullptr)
{
    SdfPrimSpecHandle primSpec = _EnsurePrimSpecInLayer(layer, primPath);
    if (!primSpec) {
        return SdfRelationshipSpecHandle();
    }

    const SdfPath relationshipPath =
        primPath.AppendProperty(relationshipName);
    if (diagnostics) {
        ++diagnostics->relationshipCreateAttempts;
    }
    SdfRelationshipSpecHandle relSpec =
        layer->GetRelationshipAtPath(relationshipPath);
    if (!relSpec) {
        relSpec = SdfRelationshipSpec::New(
            primSpec,
            relationshipName.GetString(),
            /* custom = */ false,
            SdfVariabilityUniform);
    }
    if (!relSpec && diagnostics) {
        ++diagnostics->relationshipCreateFailures;
        if (diagnostics->firstRelationshipFailurePath.empty()) {
            diagnostics->firstRelationshipFailurePath =
                relationshipPath.GetString();
        }
    }
    return relSpec;
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

class WebViewHydraSyncTask final : public HdTask
{
public:
    WebViewHydraSyncTask(
        HdRenderPassSharedPtr const& renderPass,
        TfTokenVector renderTags)
        : HdTask(SdfPath::EmptyPath())
        , _renderPass(renderPass)
        , _renderTags(std::move(renderTags))
    {
    }

    void Sync(
        HdSceneDelegate* delegate,
        HdTaskContext* ctx,
        HdDirtyBits* dirtyBits) override
    {
        if (_renderPass) {
            _renderPass->Sync();
        }
        if (dirtyBits) {
            *dirtyBits = HdChangeTracker::Clean;
        }
    }

    void Prepare(HdTaskContext* ctx, HdRenderIndex* renderIndex) override
    {
    }

    void Execute(HdTaskContext* ctx) override
    {
    }

    const TfTokenVector& GetRenderTags() const override
    {
        return _renderTags;
    }

private:
    HdRenderPassSharedPtr _renderPass;
    TfTokenVector _renderTags;
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
_TriangulateHydraTopology(
    const HdMeshTopology& topology,
    SdfPath const& id)
{
    std::vector<int> triangles;
    VtVec3iArray triangleIndices;
    VtIntArray primitiveParams;
    HdMeshUtil meshUtil(&topology, id);
    meshUtil.ComputeTriangleIndices(&triangleIndices, &primitiveParams);

    triangles.reserve(triangleIndices.size() * 3);
    for (const GfVec3i& triangle : triangleIndices) {
        triangles.push_back(triangle[0]);
        triangles.push_back(triangle[1]);
        triangles.push_back(triangle[2]);
    }

    return triangles;
}

void
_AppendSceneIndexPointComputations(
    HdSceneDelegate* delegate,
    SdfPath const& id,
    HydraMeshUpdate* update,
    HdExtComputationPrimvarDescriptorVector* pointsComputations)
{
    if (!delegate || !update || !pointsComputations) {
        return;
    }

    HdSceneIndexBaseRefPtr sceneIndex =
        delegate->GetRenderIndex().GetTerminalSceneIndex();
    if (!sceneIndex) {
        return;
    }

    HdSceneIndexPrim prim = sceneIndex->GetPrim(id);
    update->sceneIndexPrimType = prim.primType.GetString();
    if (!prim.dataSource) {
        return;
    }

    UsdSkelImagingBindingSchema binding =
        UsdSkelImagingBindingSchema::GetFromParent(prim.dataSource);
    if (binding) {
        if (HdPathDataSourceHandle skeletonDs = binding.GetSkeleton()) {
            update->sceneIndexSkeletonPath =
                skeletonDs->GetTypedValue(0.0f).GetString();
        }
        if (HdPathDataSourceHandle animationSourceDs =
                binding.GetAnimationSource()) {
            update->sceneIndexAnimationSourcePath =
                animationSourceDs->GetTypedValue(0.0f).GetString();
        }
        if (HdBoolDataSourceHandle hasSkelRootDs =
                binding.GetHasSkelRoot()) {
            update->sceneIndexHasSkelRoot =
                hasSkelRootDs->GetTypedValue(0.0f);
        }
    }

    HdExtComputationPrimvarsSchema primvars =
        HdExtComputationPrimvarsSchema::GetFromParent(prim.dataSource);
    if (!primvars) {
        return;
    }

    TfTokenVector names = primvars.GetExtComputationPrimvarNames();
    update->sceneIndexExtComputationPrimvarCount =
        static_cast<int>(names.size());

    HdExtComputationPrimvarSchema pointsPrimvar =
        primvars.GetExtComputationPrimvar(HdTokens->points);
    if (!pointsPrimvar) {
        return;
    }

    update->sceneIndexHasComputedPointsPrimvar = true;
    if (HdPathDataSourceHandle sourceDs =
            pointsPrimvar.GetSourceComputation()) {
        update->sceneIndexComputedPointsSourcePath =
            sourceDs->GetTypedValue(0.0f).GetString();
    }
    if (HdTokenDataSourceHandle outputDs =
            pointsPrimvar.GetSourceComputationOutputName()) {
        update->sceneIndexComputedPointsOutputName =
            outputDs->GetTypedValue(0.0f).GetString();
    }

    HdExtComputationPrimvarDescriptor descriptor =
        HdExtComputationPrimvarDescriptorFromSchema(
            HdTokens->points,
            pointsPrimvar);
    if (descriptor.interpolation < HdInterpolationCount &&
        !descriptor.sourceComputationId.IsEmpty()) {
        const bool alreadyPresent = std::any_of(
            pointsComputations->begin(),
            pointsComputations->end(),
            [&](const HdExtComputationPrimvarDescriptor& existing) {
                return existing.name == descriptor.name &&
                    existing.sourceComputationId == descriptor.sourceComputationId &&
                    existing.sourceComputationOutputName ==
                        descriptor.sourceComputationOutputName;
            });
        if (!alreadyPresent) {
            pointsComputations->push_back(std::move(descriptor));
        }
    }
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
            update.dirtyBits = static_cast<unsigned>(*dirtyBits);
            update.dirtyPoints =
                HdChangeTracker::IsPrimvarDirty(*dirtyBits, id, HdTokens->points);
            update.dirtyTransform =
                HdChangeTracker::IsTransformDirty(*dirtyBits, id);
            update.dirtyTopology =
                HdChangeTracker::IsTopologyDirty(*dirtyBits, id);
            _collector->Record(std::move(update));
        }

        *dirtyBits &= ~HdChangeTracker::AllSceneDirtyBits;
    }

    HdDirtyBits GetInitialDirtyBitsMask() const override
    {
        return HdChangeTracker::AllSceneDirtyBits;
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
            HdPrimTypeTokens->material,
            HdPrimTypeTokens->coordSys,
            HdPrimTypeTokens->domeLight,
            HdPrimTypeTokens->extComputation
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

emscripten::val
_Float32View(const std::vector<float>& values);

emscripten::val
_Int32View(const std::vector<int>& values);

std::vector<float>
_MatrixVector(const GfMatrix4d& matrix);

UsdSkelCache*
_GetOrPopulateSkelCache(const std::string& path, const UsdStageRefPtr& stage);

UsdSkelSkeleton
_FindSkeletonForSkinnedPrim(const std::string& stagePath, const UsdPrim& prim);

bool
_ExtractSkinnedControlPoints(
    const UsdGeomMesh& mesh,
    std::vector<float>* points,
    UsdTimeCode timeCode,
    const UsdSkelCache* skelCache,
    const UsdSkelSkeleton& skel,
    UsdGeomXformCache* xformCache);

static VtArray<GfVec3f>
_GetMeshPointsAsFloat(const UsdGeomMesh& mesh, UsdTimeCode timeCode);

class ReferenceHydraMesh final : public HdMesh
{
public:
    ReferenceHydraMesh(
        SdfPath const& id,
        emscripten::val jsPrim)
        : HdMesh(id)
        , _jsPrim(std::move(jsPrim))
    {
    }

    void Sync(
        HdSceneDelegate* delegate,
        HdRenderParam* renderParam,
        HdDirtyBits* dirtyBits,
        TfToken const& reprToken) override
    {
        const SdfPath& id = GetId();
        if (!delegate || !dirtyBits || *dirtyBits == HdChangeTracker::Clean) {
            return;
        }

        const bool dirtyPoints =
            HdChangeTracker::IsPrimvarDirty(*dirtyBits, id, HdTokens->points);
        const bool dirtyTransform =
            HdChangeTracker::IsTransformDirty(*dirtyBits, id);
        const bool dirtyTopology =
            HdChangeTracker::IsTopologyDirty(*dirtyBits, id);

        if (dirtyPoints) {
            _CopyHydraPoints(delegate->Get(id, HdTokens->points), &_points);
        }

        if (dirtyTopology || !_sentTopology) {
            _topology = delegate->GetMeshTopology(id);
        }

        if (!_sentTopology && _topology.GetFaceVertexCounts().empty()) {
            _topology = delegate->GetMeshTopology(id);
        }

        if (_points.empty()) {
            _CopyHydraPoints(delegate->Get(id, HdTokens->points), &_points);
        }

        if (!_topology.GetFaceVertexCounts().empty() &&
            !_jsPrim["updateIndices"].isUndefined()) {
            std::vector<int> indices = _TriangulateHydraTopology(_topology, id);
            if (!indices.empty()) {
                _jsPrim.call<void>("updateIndices", _Int32View(indices));
                _sentTopology = true;
            }
        }

        if (!_points.empty() && !_jsPrim["updatePoints"].isUndefined()) {
            _jsPrim.call<void>("updatePoints", _Float32View(_points));
            _sentPoints = true;
        }

        if (!_topology.GetFaceVertexCounts().empty() &&
            !_jsPrim["updateFaceVertexCounts"].isUndefined()) {
            const VtIntArray& counts = _topology.GetFaceVertexCounts();
            if (!counts.empty()) {
                _jsPrim.call<void>(
                    "updateFaceVertexCounts",
                    emscripten::val(
                        emscripten::typed_memory_view(
                            counts.size(),
                            counts.cdata())));
            }
        }

        if ((dirtyTransform || !_sentTransform) &&
            !_jsPrim["setTransform"].isUndefined()) {
            std::vector<float> matrix = _MatrixVector(delegate->GetTransform(id));
            _jsPrim.call<void>("setTransform", _Float32View(matrix));
            _sentTransform = true;
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
    emscripten::val _jsPrim;
    std::vector<float> _points;
    HdMeshTopology _topology;
    bool _sentTopology = false;
    bool _sentPoints = false;
    bool _sentTransform = false;
};

class ReferenceHydraRenderDelegate final : public HdRenderDelegate
{
public:
    explicit ReferenceHydraRenderDelegate(emscripten::val renderInterface)
        : _renderInterface(std::move(renderInterface))
    {
    }

    const TfTokenVector& GetSupportedRprimTypes() const override
    {
        static const TfTokenVector tokens = {
            HdPrimTypeTokens->mesh,
            HdPrimTypeTokens->points
        };
        return tokens;
    }

    const TfTokenVector& GetSupportedSprimTypes() const override
    {
        static const TfTokenVector tokens = {
            HdPrimTypeTokens->camera,
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
        if ((typeId != HdPrimTypeTokens->mesh &&
             typeId != HdPrimTypeTokens->points) ||
            _renderInterface["createRPrim"].isUndefined()) {
            return nullptr;
        }
        emscripten::val jsPrim = _renderInterface.call<emscripten::val>(
            "createRPrim",
            typeId.GetString(),
            rprimId.GetString());
        return new ReferenceHydraMesh(rprimId, std::move(jsPrim));
    }

    void DestroyRprim(HdRprim* rprim) override
    {
        delete rprim;
    }

    HdSprim* CreateSprim(TfToken const& typeId, SdfPath const& sprimId) override
    {
        if (typeId == HdPrimTypeTokens->material) {
            return new WebViewHydraSprim<HdMaterial>(sprimId);
        }
        if (typeId == HdPrimTypeTokens->camera) {
            return new WebViewHydraSprim<HdCamera>(sprimId);
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
    emscripten::val _renderInterface;
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
        _TriangulateHydraTopology(delegate->GetMeshTopology(id), id);

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
    if (animationSourcePath.IsEmpty() && !skeletonPath.IsEmpty()) {
        if (UsdPrim skeleton = prim.GetStage()->GetPrimAtPath(skeletonPath)) {
            if (UsdPrim animationSource =
                    _InferAnimationForSkeleton(skeleton)) {
                animationSourcePath = animationSource.GetPath();
            }
        }
    }
    if (!animationSourcePath.IsEmpty()) {
        animationSourceDs =
            HdRetainedTypedSampledDataSource<SdfPath>::New(
                animationSourcePath);
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

void
_SyncHydraRenderIndexGeometry(HdRenderIndex* renderIndex)
{
    if (!renderIndex) {
        return;
    }

    // This bridge has no native render pass object, so make sure Hydra knows
    // the geometry collection is wanted before SyncAll() gathers dirty rprims.
    // Do not call MarkAllRprimsDirty() here: this scene-index render index has
    // legacy emulation APIs disabled, and OpenUSD will report a coding error.
    HdChangeTracker& changeTracker = renderIndex->GetChangeTracker();
    changeTracker.MarkCollectionDirty(HdTokens->geometry);

    HdRprimCollection collection(
        HdTokens->geometry,
        HdReprSelector(HdReprTokens->refined));
    renderIndex->EnqueueCollectionToSync(collection);

    HdTaskSharedPtrVector tasks;
    HdTaskContext taskContext;
    renderIndex->SyncAll(&tasks, &taskContext);
}

struct HydraAnimationDriver
{
    HydraAnimationDriver(std::string stagePath, UsdStageRefPtr stage)
        : stage(std::move(stage))
        , stagePath(std::move(stagePath))
        , renderDelegate(&collector)
    {
        if (this->stage) {
            // Match the working web viewers' animation shape: a persistent
            // legacy UsdImagingDelegate drives a custom Hydra render delegate.
            // The scene-index adapter path is useful for diagnostics, but its
            // ExtComputation bridge has been observed to return static skinned
            // inputs after time changes in this WASM build.
            renderIndex.reset(HdRenderIndex::New(
                &renderDelegate,
                HdDriverVector()));
            imagingDelegate = std::make_unique<UsdImagingDelegate>(
                renderIndex.get(),
                SdfPath::AbsoluteRootPath());
            imagingDelegate->SetRefineLevelFallback(0);

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

            collection = HdRprimCollection(
                HdTokens->geometry,
                HdReprSelector(HdReprTokens->refined));
            renderTags.push_back(HdRenderTagTokens->geometry);
            geometryPass = HdRenderPassSharedPtr(
                new Hd_UnitTestNullRenderPass(
                    renderIndex.get(),
                    collection));
        }
    }

    UsdStageRefPtr stage;
    std::string stagePath;
    UsdImagingSceneIndices sceneIndices;
    WebViewHydraMeshCollector collector;
    WebViewHydraRenderDelegate renderDelegate;
    HdEngine engine;
    HdRprimCollection collection;
    TfTokenVector renderTags;
    HdRenderPassSharedPtr geometryPass;
    std::unique_ptr<HdRenderIndex> renderIndex;
    std::unique_ptr<UsdImagingDelegate> imagingDelegate;
};

UsdStageRefPtr
_GetOrOpenStage(const std::string& path, bool loadAllPayloads = true);

class ReferenceHydraSyncDriver
{
public:
    ReferenceHydraSyncDriver(std::string stagePath, emscripten::val renderInterface)
        : _stagePath(std::move(stagePath))
        , _renderDelegate(std::move(renderInterface))
    {
        _stage = _GetOrOpenStage(_stagePath);
        if (!_stage) {
            return;
        }

        _startTimeCode = _stage->GetStartTimeCode();
        _endTimeCode = _stage->GetEndTimeCode();
        _timeCodesPerSecond = _stage->GetTimeCodesPerSecond();
        _timeCode = _startTimeCode;

        _renderIndex.reset(HdRenderIndex::New(
            &_renderDelegate,
            HdDriverVector()));
        _imagingDelegate = std::make_unique<UsdImagingDelegate>(
            _renderIndex.get(),
            SdfPath::AbsoluteRootPath());
        _imagingDelegate->SetRefineLevelFallback(0);

        UsdSkelBakeSkinning(_stage->Traverse());

        _imagingDelegate->Populate(_stage->GetPseudoRoot());

        _collection = HdRprimCollection(
            HdTokens->geometry,
            HdReprSelector(HdReprTokens->refined));
        _renderTags.push_back(HdRenderTagTokens->geometry);
        _geometryPass = HdRenderPassSharedPtr(
            new Hd_UnitTestNullRenderPass(
                _renderIndex.get(),
                _collection));
        _imagingDelegate->ApplyPendingUpdates();
    }

    void SetTime(double timeCode)
    {
        _timeCode = timeCode;
        if (_imagingDelegate) {
            _imagingDelegate->SetTime(UsdTimeCode(timeCode));
            HdChangeTracker& tracker = _renderIndex->GetChangeTracker();
            for (const SdfPath& primPath : _renderIndex->GetRprimIds()) {
                tracker.MarkRprimDirty(
                    primPath,
                    HdChangeTracker::DirtyTransform);
            }
        }
    }

    void Draw()
    {
        if (!_renderIndex || !_imagingDelegate) {
            return;
        }

        _imagingDelegate->ApplyPendingUpdates();
        HdTaskSharedPtrVector tasks = {
            std::make_shared<WebViewHydraSyncTask>(
                _geometryPass,
                _renderTags)
        };
        _engine.Execute(&_imagingDelegate->GetRenderIndex(), &tasks);
    }

    double GetStartTimeCode() const
    {
        return _startTimeCode;
    }

    double GetEndTimeCode() const
    {
        return _endTimeCode;
    }

    double GetTimeCodesPerSecond() const
    {
        return _timeCodesPerSecond;
    }

    bool IsValid() const
    {
        return _stage && _renderIndex && _imagingDelegate;
    }

private:
    std::string _stagePath;
    UsdStageRefPtr _stage;
    ReferenceHydraRenderDelegate _renderDelegate;
    HdEngine _engine;
    HdRprimCollection _collection;
    TfTokenVector _renderTags;
    HdRenderPassSharedPtr _geometryPass;
    std::unique_ptr<HdRenderIndex> _renderIndex;
    std::unique_ptr<UsdImagingDelegate> _imagingDelegate;
    double _timeCode = 0.0;
    double _startTimeCode = 0.0;
    double _endTimeCode = 0.0;
    double _timeCodesPerSecond = 24.0;
};

// One record per stage path: consolidates every per-stage cache that used to
// live in separate g_* maps so open/invalidate/close stay coherent and
// CloseStage can drop everything at once.
struct StageRecord
{
    UsdStageRefPtr stage;
    bool loadAllPayloadsOnOpen = true;
    std::unique_ptr<UsdSkelCache> skelCache;
    std::optional<bool> hasSkelRoot;
    std::unordered_map<std::string, UsdSkelSkeleton> skinningSkeletonByPrim;
    std::optional<int> authoredLegacySkelBindingTargets;
    std::optional<LegacySkelBindingAuthoringDiagnostics>
        legacySkelBindingDiagnostics;
    std::unique_ptr<HydraAnimationDriver> hydraAnimationDriver;
    std::string lastSkelBindingOverlayContents;

    void ResetDerivedCaches()
    {
        skelCache.reset();
        hasSkelRoot.reset();
        skinningSkeletonByPrim.clear();
        hydraAnimationDriver.reset();
        authoredLegacySkelBindingTargets.reset();
        legacySkelBindingDiagnostics.reset();
    }
};

std::unordered_map<std::string, StageRecord> g_stageRegistry;

StageRecord&
_GetStageRecord(const std::string& path)
{
    return g_stageRegistry[path];
}

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

struct StageAuthoredStats
{
    int meshPrimCount = 0;
    int authoredPointCount = 0;
    int authoredFaceCount = 0;
    int materialPrimCount = 0;
    int materialBindingCount = 0;
    int textureAssetCount = 0;
    int payloadPrimCount = 0;
    int variantSetCount = 0;
    int instancePrimCount = 0;
};

StageAuthoredStats
_CollectStageAuthoredStats(const UsdStageRefPtr& stage)
{
    StageAuthoredStats stats;
    std::unordered_set<std::string> textureAssetPaths;

    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot())) {
        if (prim.IsPseudoRoot()) {
            continue;
        }

        if (prim.HasAuthoredPayloads()) {
            ++stats.payloadPrimCount;
        }
        if (prim.IsInstance()) {
            ++stats.instancePrimCount;
        }

        std::vector<std::string> variantSetNames;
        prim.GetVariantSets().GetNames(&variantSetNames);
        stats.variantSetCount += static_cast<int>(variantSetNames.size());

        if (prim.HasRelationship(TfToken("material:binding"))) {
            ++stats.materialBindingCount;
        }

        if (prim.IsA<UsdShadeMaterial>()) {
            ++stats.materialPrimCount;
        }

        if (prim.IsA<UsdShadeShader>()) {
            UsdShadeShader shader(prim);
            SdfAssetPath filePath;
            UsdShadeInput fileInput = shader.GetInput(TfToken("file"));
            if (fileInput && fileInput.Get(&filePath)) {
                const std::string path = !filePath.GetResolvedPath().empty()
                    ? filePath.GetResolvedPath()
                    : filePath.GetAssetPath();
                if (!path.empty()) {
                    textureAssetPaths.insert(path);
                }
            }
        }

        if (prim.IsA<UsdGeomMesh>()) {
            ++stats.meshPrimCount;
            UsdGeomMesh mesh(prim);

            VtArray<GfVec3f> points;
            if (mesh.GetPointsAttr().Get(&points)) {
                stats.authoredPointCount += static_cast<int>(points.size());
            }

            VtArray<int> faceVertexCounts;
            if (mesh.GetFaceVertexCountsAttr().Get(&faceVertexCounts)) {
                stats.authoredFaceCount += static_cast<int>(faceVertexCounts.size());
            }
        }
    }

    stats.textureAssetCount = static_cast<int>(textureAssetPaths.size());
    return stats;
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
    static std::atomic<bool> initialized{false};
    if (initialized.exchange(true)) {
        return;
    }

    _ForceUsdSkelImagingStaticRegistration();
    TfType::Define<GfHalf>();
    PlugRegistry::GetInstance().RegisterPlugins("/usd");

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
_MatrixArrayVector(const std::vector<GfMatrix4d>& matrices)
{
    emscripten::val array = emscripten::val::array();
    for (size_t index = 0; index < matrices.size(); ++index) {
        array.set(index, _MatrixArray(matrices[index]));
    }
    return array;
}

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

emscripten::val
_Float32Array(const std::vector<float>& values)
{
    if (values.empty()) {
        return emscripten::val::global("Float32Array").new_(0);
    }
    return emscripten::val::global("Float32Array")
        .new_(emscripten::typed_memory_view(values.size(), values.data()));
}

emscripten::val
_Float32View(const std::vector<float>& values)
{
    if (values.empty()) {
        return emscripten::val::global("Float32Array").new_(0);
    }
    return emscripten::val(
        emscripten::typed_memory_view(values.size(), values.data()));
}

emscripten::val
_Int32View(const std::vector<int>& values)
{
    if (values.empty()) {
        return emscripten::val::global("Int32Array").new_(0);
    }
    return emscripten::val(
        emscripten::typed_memory_view(values.size(), values.data()));
}

std::vector<float>
_MatrixVector(const GfMatrix4d& matrix)
{
    std::vector<float> values;
    values.reserve(16);
    for (size_t row = 0; row < 4; ++row) {
        for (size_t column = 0; column < 4; ++column) {
            values.push_back(static_cast<float>(matrix[row][column]));
        }
    }
    return values;
}

template <typename T>
bool
_FormatVtArrayPreview(
    const VtValue& value,
    std::string* result,
    size_t maxElements = 512)
{
    if (!value.IsHolding<VtArray<T>>()) {
        return false;
    }

    const VtArray<T>& array = value.UncheckedGet<VtArray<T>>();
    std::ostringstream oss;
    const size_t count = std::min(array.size(), maxElements);
    for (size_t i = 0; i < count; ++i) {
        if (i > 0) {
            oss << ", ";
        }
        oss << array[i];
    }
    if (array.size() > count) {
        if (count > 0) {
            oss << ", ";
        }
        oss << "... " << (array.size() - count) << " more";
    }
    *result = oss.str();
    return true;
}

bool
_FormatVtArrayPreview(const VtValue& value, std::string* result)
{
    return
        _FormatVtArrayPreview<int>(value, result) ||
        _FormatVtArrayPreview<unsigned int>(value, result) ||
        _FormatVtArrayPreview<int64_t>(value, result) ||
        _FormatVtArrayPreview<uint64_t>(value, result) ||
        _FormatVtArrayPreview<float>(value, result) ||
        _FormatVtArrayPreview<double>(value, result) ||
        _FormatVtArrayPreview<GfHalf>(value, result) ||
        _FormatVtArrayPreview<GfVec2f>(value, result) ||
        _FormatVtArrayPreview<GfVec3f>(value, result) ||
        _FormatVtArrayPreview<GfVec4f>(value, result) ||
        _FormatVtArrayPreview<GfVec2d>(value, result) ||
        _FormatVtArrayPreview<GfVec3d>(value, result) ||
        _FormatVtArrayPreview<GfVec4d>(value, result) ||
        _FormatVtArrayPreview<GfVec2i>(value, result) ||
        _FormatVtArrayPreview<GfVec3i>(value, result) ||
        _FormatVtArrayPreview<GfVec4i>(value, result) ||
        _FormatVtArrayPreview<TfToken>(value, result) ||
        _FormatVtArrayPreview<std::string>(value, result);
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

SdfPathVector
_GetMaterialBindingTargets(const UsdPrim& bindingPrim, const UsdRelationship& relationship)
{
    SdfPathVector targets;
    if (!relationship.GetForwardedTargets(&targets) || targets.empty()) {
        targets.clear();
        relationship.GetTargets(&targets);
    }
    if (targets.empty()) {
        targets = _GetRelationshipTargetsFromLayers(bindingPrim, relationship.GetName());
    }
    return targets;
}

TfToken
_GetMaterialBindingStrength(const UsdRelationship& relationship)
{
    TfToken bindingStrength;
    relationship.GetMetadata(UsdShadeTokens->bindMaterialAs, &bindingStrength);
    return bindingStrength.IsEmpty()
        ? UsdShadeTokens->weakerThanDescendants
        : bindingStrength;
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
    UsdShadeMaterial weakestDescendantMaterial;
    for (UsdPrim bindingPrim = prim; bindingPrim && !bindingPrim.IsPseudoRoot();
         bindingPrim = bindingPrim.GetParent()) {
        for (const UsdRelationship& relationship : bindingPrim.GetRelationships()) {
            if (!_RelationshipNameLooksLikeMaterialBinding(relationship.GetName())) {
                continue;
            }

            for (const SdfPath& target :
                 _GetMaterialBindingTargets(bindingPrim, relationship)) {
                const SdfPath materialPath = target.IsPrimPath() ? target : target.GetPrimPath();
                UsdShadeMaterial material(stage->GetPrimAtPath(materialPath));
                if (material) {
                    if (_GetMaterialBindingStrength(relationship) ==
                        UsdShadeTokens->strongerThanDescendants) {
                        return material;
                    }
                    if (!weakestDescendantMaterial) {
                        weakestDescendantMaterial = material;
                    }
                }
            }
        }
    }

    return weakestDescendantMaterial;
}

UsdPrim
_FindBoundMaterialPrimByAuthoredRelationships(const UsdPrim& prim)
{
    UsdStageWeakPtr stage = prim.GetStage();
    UsdPrim weakestDescendantMaterialPrim;
    for (UsdPrim bindingPrim = prim; bindingPrim && !bindingPrim.IsPseudoRoot();
         bindingPrim = bindingPrim.GetParent()) {
        for (const UsdRelationship& relationship : bindingPrim.GetRelationships()) {
            if (!_RelationshipNameLooksLikeMaterialBinding(relationship.GetName())) {
                continue;
            }

            for (const SdfPath& target :
                 _GetMaterialBindingTargets(bindingPrim, relationship)) {
                const SdfPath materialPath = target.IsPrimPath() ? target : target.GetPrimPath();
                UsdPrim materialPrim = stage->GetPrimAtPath(materialPath);
                if (materialPrim) {
                    if (_GetMaterialBindingStrength(relationship) ==
                        UsdShadeTokens->strongerThanDescendants) {
                        return materialPrim;
                    }
                    if (!weakestDescendantMaterialPrim) {
                        weakestDescendantMaterialPrim = materialPrim;
                    }
                }
            }
        }
    }

    if (weakestDescendantMaterialPrim) {
        return weakestDescendantMaterialPrim;
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
    sessionLayer->SetPermissionToEdit(true);
    if (diagnostics) {
        diagnostics->sessionLayerIdentifier = sessionLayer->GetIdentifier();
    }

    // Populate a local skel cache to find skinning queries via primvar inspection.
    // GetSkinningQuery works from joint-indices/weights primvars and does not
    // require UsdSkelBindingAPI to be applied, so this succeeds for older USDZ
    // files that omit apiSchemas authoring.
    UsdSkelCache skinningQueryCache;
    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot())) {
        if (prim.IsA<UsdSkelRoot>()) {
            skinningQueryCache.Populate(
                UsdSkelRoot(prim),
                UsdTraverseInstanceProxies());
        }
    }

    int authoredCount = 0;

    // All edits go to the session layer so the source asset is never modified.
    UsdEditContext editContext(
        stage,
        stage->GetEditTargetForLocalLayer(sessionLayer));

    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot())) {
        // For skeleton prims: author skel:animationSource if it is missing.
        // UsdSkelCache::_FindOrCreateSkelQuery needs this to build the anim query
        // that drives skinning-transform evaluation at each time code.
        if (prim.GetTypeName() == kSkeletonType) {
            if (diagnostics) {
                ++diagnostics->skeletonPrims;
            }

            UsdSkelBindingAPI existingBinding(prim);
            SdfPathVector existingTargets;
            UsdRelationship existingRel = existingBinding.GetAnimationSourceRel();
            if (existingRel && existingRel.GetTargets(&existingTargets)
                    && !existingTargets.empty()) {
                continue;
            }

            UsdPrim animation = _InferAnimationForSkeleton(prim);
            if (!animation) {
                continue;
            }
            if (diagnostics) {
                ++diagnostics->animationTargets;
            }

            SdfRelationshipSpecHandle relSpec =
                _EnsureRelationshipSpecInLayer(
                    sessionLayer,
                    prim.GetPath(),
                    UsdSkelTokens->skelAnimationSource,
                    diagnostics);
            if (relSpec) {
                relSpec->GetTargetPathList().Prepend(animation.GetPath());
                ++authoredCount;
                if (diagnostics) {
                    ++diagnostics->relationshipSpecs;
                }
            }
            continue;
        }

        // For mesh prims: apply UsdSkelBindingAPI + author skel:skeleton.
        //
        // UsdSkelCache::ComputeSkelBindings (called by UsdSkelImagingSkelRootAdapter
        // during Populate) requires HasAPI<UsdSkelBindingAPI>() to return true before
        // it will call GetSkeleton() on the prim.  Older Apple USDZ files author the
        // skel:skeleton relationship without stamping apiSchemas, so ComputeSkelBindings
        // returns empty and the legacy imaging adapter never registers ext computations
        // for skinned-point evaluation.  Applying the schema in the session layer fixes
        // this without touching the source asset.
        if (!prim.IsA<UsdGeomMesh>()) {
            continue;
        }
        if (diagnostics) {
            ++diagnostics->meshPrims;
        }
        if (!skinningQueryCache.GetSkinningQuery(prim)) {
            continue;
        }
        if (diagnostics) {
            ++diagnostics->meshSkinningQueries;
        }

        // Skip if the binding is already complete.
        if (prim.HasAPI<UsdSkelBindingAPI>()) {
            UsdSkelSkeleton existingSkel;
            if (UsdSkelBindingAPI(prim).GetSkeleton(&existingSkel)) {
                continue;
            }
        }

        UsdPrim skeleton = _InferSkeletonForSkelBoundPrim(prim);
        if (!skeleton) {
            continue;
        }
        if (diagnostics) {
            ++diagnostics->meshInferredSkeletons;
        }

        SdfRelationshipSpecHandle relSpec =
            _EnsureRelationshipSpecInLayer(
                sessionLayer,
                prim.GetPath(),
                UsdSkelTokens->skelSkeleton,
                diagnostics);
        if (relSpec) {
            relSpec->GetTargetPathList().Prepend(skeleton.GetPath());
            ++authoredCount;
            if (diagnostics) {
                ++diagnostics->relationshipSpecs;
            }
        }
    }

    return authoredCount;
}

int
_AuthorInferredSkelBindingTargetsToLayer(
    const UsdStageRefPtr& sourceStage,
    const SdfLayerHandle& targetLayer,
    LegacySkelBindingAuthoringDiagnostics* diagnostics)
{
    if (!sourceStage || !targetLayer) {
        return 0;
    }
    if (diagnostics) {
        diagnostics->sessionLayerIdentifier = targetLayer->GetIdentifier();
    }

    UsdSkelCache skinningQueryCache;
    for (const UsdPrim& prim : UsdPrimRange(sourceStage->GetPseudoRoot())) {
        if (prim.IsA<UsdSkelRoot>()) {
            skinningQueryCache.Populate(
                UsdSkelRoot(prim),
                UsdTraverseInstanceProxies());
        }
    }

    int authoredCount = 0;
    static const TfToken kSkeletonType("Skeleton");
    for (const UsdPrim& prim : UsdPrimRange(sourceStage->GetPseudoRoot())) {
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

            SdfRelationshipSpecHandle relSpec =
                _EnsureRelationshipSpecInLayer(
                    targetLayer,
                    prim.GetPath(),
                    UsdSkelTokens->skelAnimationSource,
                    diagnostics);
            if (relSpec) {
                relSpec->GetTargetPathList().Prepend(animation.GetPath());
                ++authoredCount;
                if (diagnostics) {
                    ++diagnostics->relationshipSpecs;
                }
            }
            continue;
        }

        if (!prim.IsA<UsdGeomMesh>()) {
            continue;
        }
        if (diagnostics) {
            ++diagnostics->meshPrims;
        }
        if (!skinningQueryCache.GetSkinningQuery(prim)) {
            continue;
        }
        if (diagnostics) {
            ++diagnostics->meshSkinningQueries;
        }

        UsdPrim skeleton = _InferSkeletonForSkelBoundPrim(prim);
        if (!skeleton) {
            continue;
        }
        if (diagnostics) {
            ++diagnostics->meshInferredSkeletons;
        }

        SdfRelationshipSpecHandle relSpec =
            _EnsureRelationshipSpecInLayer(
                targetLayer,
                prim.GetPath(),
                UsdSkelTokens->skelSkeleton,
                diagnostics);
        if (relSpec) {
            relSpec->GetTargetPathList().Prepend(skeleton.GetPath());
            ++authoredCount;
            if (diagnostics) {
                ++diagnostics->relationshipSpecs;
            }
        }
    }

    return authoredCount;
}

std::string
_BuildInferredSkelBindingOverlayUsda(
    const std::string& stagePath,
    const UsdStageRefPtr& sourceStage,
    LegacySkelBindingAuthoringDiagnostics* diagnostics,
    int* authoredCount)
{
    if (authoredCount) {
        *authoredCount = 0;
    }
    if (!sourceStage) {
        return std::string();
    }

    UsdSkelCache skinningQueryCache;
    for (const UsdPrim& prim : UsdPrimRange(sourceStage->GetPseudoRoot())) {
        if (prim.IsA<UsdSkelRoot>()) {
            skinningQueryCache.Populate(
                UsdSkelRoot(prim),
                UsdTraverseInstanceProxies());
        }
    }

    UsdaOverlayPrim root;
    int localAuthoredCount = 0;
    static const TfToken kSkeletonType("Skeleton");
    for (const UsdPrim& prim : UsdPrimRange(sourceStage->GetPseudoRoot())) {
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

            _AddUsdaOverlayRelationship(
                &root,
                prim.GetPath(),
                UsdSkelTokens->skelAnimationSource.GetString(),
                animation.GetPath());
            ++localAuthoredCount;
            if (diagnostics) {
                ++diagnostics->relationshipSpecs;
            }
            continue;
        }

        if (!prim.IsA<UsdGeomMesh>()) {
            continue;
        }
        if (diagnostics) {
            ++diagnostics->meshPrims;
        }
        if (!skinningQueryCache.GetSkinningQuery(prim)) {
            continue;
        }
        if (diagnostics) {
            ++diagnostics->meshSkinningQueries;
        }

        UsdPrim skeleton = _InferSkeletonForSkelBoundPrim(prim);
        if (!skeleton) {
            continue;
        }
        if (diagnostics) {
            ++diagnostics->meshInferredSkeletons;
        }

        _AddUsdaOverlayRelationship(
            &root,
            prim.GetPath(),
            UsdSkelTokens->skelSkeleton.GetString(),
            skeleton.GetPath());
        ++localAuthoredCount;
        if (diagnostics) {
            ++diagnostics->relationshipSpecs;
        }
    }

    if (localAuthoredCount <= 0) {
        return std::string();
    }

    std::ostringstream oss;
    oss << "#usda 1.0\n";
    oss << "(\n";
    oss << "    subLayers = [\n";
    oss << "        @" << _EscapeUsdaAssetPath(stagePath) << "@\n";
    oss << "    ]\n";
    oss << ")\n\n";
    for (const auto& child : root.children) {
        _WriteUsdaOverlayPrim(oss, child.second, child.first, 0);
    }

    if (authoredCount) {
        *authoredCount = localAuthoredCount;
    }
    return oss.str();
}

UsdStageRefPtr
_CreateSkelBindingOverlayStage(
    const std::string& stagePath,
    const UsdStageRefPtr& sourceStage,
    LegacySkelBindingAuthoringDiagnostics* diagnostics)
{
    if (!sourceStage) {
        return nullptr;
    }

    SdfLayerRefPtr overlayLayer =
        SdfLayer::CreateAnonymous("usd-webview-skel-binding-overlay.usda");
    if (!overlayLayer) {
        return nullptr;
    }
    overlayLayer->SetPermissionToEdit(true);

    int authoredCount = 0;
    const std::string overlayContents =
        _BuildInferredSkelBindingOverlayUsda(
            stagePath,
            sourceStage,
            diagnostics,
            &authoredCount);
    if (authoredCount <= 0) {
        return nullptr;
    }

    if (!overlayLayer->ImportFromString(overlayContents)) {
        if (diagnostics) {
            diagnostics->firstRelationshipFailurePath =
                "overlay ImportFromString failed";
        }
        return nullptr;
    }
    _GetStageRecord(stagePath).lastSkelBindingOverlayContents = overlayContents;
    return UsdStage::Open(overlayLayer);
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
    if (extension == "hdr") {
        return "image/vnd.radiance";
    }
    if (extension == "exr") {
        return "image/x-exr";
    }
    if (extension == "mtlx") {
        return "application/mtlx+xml";
    }
    if (extension == "zip") {
        return "application/zip";
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

emscripten::val
_ExtractStageEnvironment(const UsdStageRefPtr& stage)
{
    if (!stage) {
        return emscripten::val::undefined();
    }

    std::string packageRootPath = _GetLayerIdentifier(stage->GetRootLayer());
    if (ArIsPackageRelativePath(packageRootPath)) {
        const size_t bracketPos = packageRootPath.find('[');
        if (bracketPos != std::string::npos) {
            packageRootPath = packageRootPath.substr(0, bracketPos);
        }
    }

    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot())) {
        UsdLuxDomeLight domeLight(prim);
        if (!domeLight) {
            continue;
        }

        SdfAssetPath textureFile;
        if (!domeLight.GetTextureFileAttr().Get(&textureFile)) {
            continue;
        }

        const std::string rawPath = !textureFile.GetResolvedPath().empty()
            ? textureFile.GetResolvedPath()
            : textureFile.GetAssetPath();
        if (rawPath.empty()) {
            continue;
        }

        emscripten::val texture = _ReadTextureAsset(rawPath, packageRootPath);
        if (texture["data"].isUndefined()) {
            continue;
        }

        float intensity = 1.0f;
        domeLight.GetIntensityAttr().Get(&intensity);

        float exposure = 0.0f;
        domeLight.GetExposureAttr().Get(&exposure);

        emscripten::val environment = emscripten::val::object();
        environment.set("sourcePath", prim.GetPath().GetString());
        environment.set("intensity", intensity * std::pow(2.0f, exposure));
        environment.set("texture", texture);
        return environment;
    }

    return emscripten::val::undefined();
}

bool
_IsMaterialXAssetPath(const std::string& path)
{
    const std::string lower = TfStringToLower(path);
    return TfStringEndsWith(lower, ".mtlx") || TfStringEndsWith(lower, ".mtlx.zip");
}

bool
_GetMaterialXSourceAsset(
    const UsdShadeShader& shader,
    SdfAssetPath* sourceAsset,
    TfToken* subIdentifier,
    TfToken* sourceTypeOut = nullptr)
{
    if (!shader || shader.GetImplementationSource() != UsdShadeTokens->sourceAsset) {
        return false;
    }

    static const TfToken kSourceTypes[] = {
        TfToken(),
        TfToken("mtlx"),
        TfToken("materialx"),
    };

    for (const TfToken& sourceType : kSourceTypes) {
        SdfAssetPath candidate;
        if (!shader.GetSourceAsset(&candidate, sourceType)) {
            continue;
        }

        const std::string candidatePath = !candidate.GetResolvedPath().empty()
            ? candidate.GetResolvedPath()
            : candidate.GetAssetPath();
        if (!_IsMaterialXAssetPath(candidatePath)) {
            continue;
        }

        TfToken candidateSubIdentifier;
        shader.GetSourceAssetSubIdentifier(&candidateSubIdentifier, sourceType);
        *sourceAsset = candidate;
        *subIdentifier = candidateSubIdentifier;
        if (sourceTypeOut) {
            *sourceTypeOut = sourceType;
        }
        return true;
    }

    return false;
}

emscripten::val
_ReadMaterialXAsset(
    const UsdShadeShader& shader,
    const std::string& packageRootPath)
{
    SdfAssetPath sourceAsset;
    TfToken subIdentifier;
    if (!_GetMaterialXSourceAsset(shader, &sourceAsset, &subIdentifier)) {
        return emscripten::val::undefined();
    }

    const std::string rawPath = !sourceAsset.GetResolvedPath().empty()
        ? sourceAsset.GetResolvedPath()
        : sourceAsset.GetAssetPath();
    emscripten::val asset = _ReadTextureAsset(rawPath, packageRootPath);
    if (asset["data"].isUndefined()) {
        return emscripten::val::undefined();
    }

    if (!subIdentifier.IsEmpty()) {
        asset.set("materialName", subIdentifier.GetString());
    }
    return asset;
}

bool
_GetMaterialXReferenceForMaterialPrim(
    const UsdPrim& materialPrim,
    SdfAssetPath* sourceAsset)
{
    if (!materialPrim || !sourceAsset) {
        return false;
    }

    for (UsdPrim prim = materialPrim; prim; prim = prim.GetParent()) {
        const std::vector<SdfPrimSpecHandle>& primStack = prim.GetPrimStack();
        for (const SdfPrimSpecHandle& primSpec : primStack) {
            if (!primSpec) {
                continue;
            }

            const std::vector<SdfReference>& references =
                primSpec->GetReferenceList().GetAppliedItems();
            for (const SdfReference& reference : references) {
                const std::string assetPath = reference.GetAssetPath();
                if (_IsMaterialXAssetPath(assetPath)) {
                    std::string resolvedAssetPath = assetPath;
                    if (SdfLayerHandle layer = primSpec->GetLayer()) {
                        const std::string anchoredAssetPath =
                            layer->ComputeAbsolutePath(assetPath);
                        if (!anchoredAssetPath.empty()) {
                            resolvedAssetPath = anchoredAssetPath;
                        }
                    }
                    *sourceAsset = SdfAssetPath(assetPath, resolvedAssetPath);
                    return true;
                }
            }
        }
    }

    return false;
}

emscripten::val
_ReadMaterialXAssetFromMaterialPrim(
    const UsdPrim& materialPrim,
    const std::string& packageRootPath)
{
    SdfAssetPath sourceAsset;
    if (!_GetMaterialXReferenceForMaterialPrim(materialPrim, &sourceAsset)) {
        return emscripten::val::undefined();
    }

    const std::string rawPath = !sourceAsset.GetResolvedPath().empty()
        ? sourceAsset.GetResolvedPath()
        : sourceAsset.GetAssetPath();
    emscripten::val asset = _ReadTextureAsset(rawPath, packageRootPath);
    if (asset["data"].isUndefined()) {
        return emscripten::val::undefined();
    }

    asset.set("materialName", materialPrim.GetName().GetString());
    return asset;
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

    UsdShadeMaterial material = _FindBoundMaterialByAuthoredRelationships(prim);
    if (!material) {
        material = UsdShadeMaterialBindingAPI(prim).ComputeBoundMaterial(
            bindingsCache,
            collectionQueryCache);
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

    if (shader) {
        emscripten::val materialX = _ReadMaterialXAsset(shader, packageRootPath);
        if (!materialX.isUndefined()) {
            materialValue.set("materialX", materialX);
            return materialValue;
        }
    }

    emscripten::val materialX = _ReadMaterialXAssetFromMaterialPrim(materialPrim, packageRootPath);
    if (!materialX.isUndefined()) {
        materialValue.set("materialX", materialX);
        return materialValue;
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

std::vector<MaterialSubsetGroup>
_ExtractMaterialSubsetGroupsFromFaceRuns(
    const UsdGeomMesh& mesh,
    const std::vector<int>& faceIndexStarts,
    const std::vector<int>& faceIndexCounts)
{
    std::vector<MaterialSubsetGroup> groups;
    for (const UsdPrim& child : mesh.GetPrim().GetChildren()) {
        if (!child.IsA<UsdGeomSubset>()) {
            continue;
        }

        TfToken elementType;
        child.GetAttribute(TfToken("elementType")).Get(&elementType);
        if (elementType != TfToken("face")) {
            continue;
        }

        TfToken familyName;
        child.GetAttribute(TfToken("familyName")).Get(&familyName);
        if (!familyName.IsEmpty() && familyName != TfToken("materialBind")) {
            continue;
        }

        VtArray<int> faceIndices;
        if (!child.GetAttribute(TfToken("indices")).Get(&faceIndices) ||
            faceIndices.empty()) {
            continue;
        }

        std::vector<int> sortedFaceIndices(faceIndices.begin(), faceIndices.end());
        std::sort(sortedFaceIndices.begin(), sortedFaceIndices.end());

        int runStart = -1;
        int runEnd = -1;
        for (const int faceIndex : sortedFaceIndices) {
            if (faceIndex < 0 ||
                static_cast<size_t>(faceIndex) >= faceIndexStarts.size()) {
                continue;
            }
            const int start = faceIndexStarts[faceIndex];
            const int count = faceIndexCounts[faceIndex];
            if (count <= 0) {
                continue;
            }

            if (runStart < 0) {
                runStart = start;
                runEnd = start + count;
                continue;
            }
            if (start == runEnd) {
                runEnd += count;
                continue;
            }

            groups.push_back({child, runStart, runEnd - runStart});
            runStart = start;
            runEnd = start + count;
        }

        if (runStart >= 0 && runEnd > runStart) {
            groups.push_back({child, runStart, runEnd - runStart});
        }
    }

    std::sort(
        groups.begin(),
        groups.end(),
        [](const MaterialSubsetGroup& a, const MaterialSubsetGroup& b) {
            return a.start < b.start;
        });
    return groups;
}

std::vector<MaterialSubsetGroup>
_ExtractMaterialSubsetGroups(const UsdGeomMesh& mesh, const MeshPayload& payload)
{
    return _ExtractMaterialSubsetGroupsFromFaceRuns(
        mesh,
        payload.faceIndexStarts,
        payload.faceIndexCounts);
}

bool
_BuildTriangulatedFaceIndexRuns(
    const UsdGeomMesh& mesh,
    std::vector<int>* faceIndexStarts,
    std::vector<int>* faceIndexCounts)
{
    if (!faceIndexStarts || !faceIndexCounts) {
        return false;
    }

    VtArray<int> faceVertexCounts;
    if (!mesh.GetFaceVertexCountsAttr().Get(&faceVertexCounts) ||
        faceVertexCounts.empty()) {
        return false;
    }

    faceIndexStarts->clear();
    faceIndexCounts->clear();
    faceIndexStarts->reserve(faceVertexCounts.size());
    faceIndexCounts->reserve(faceVertexCounts.size());

    int faceStart = 0;
    for (const int faceVertexCount : faceVertexCounts) {
        const int faceCount = faceVertexCount >= 3 ? (faceVertexCount - 2) * 3 : 0;
        faceIndexStarts->push_back(faceStart);
        faceIndexCounts->push_back(faceCount);
        faceStart += faceCount;
    }

    return true;
}

bool
_ExtractMeshPayload(
    const UsdGeomMesh& mesh,
    MeshPayload* payload,
    UsdTimeCode timeCode = UsdTimeCode::Default(),
    const UsdSkelCache* skelCache = nullptr,
    const UsdSkelSkeleton& skel = UsdSkelSkeleton(),
    UsdGeomXformCache* xformCache = nullptr);

void
_MaybeSetRenderableMaterialSubsets(
    emscripten::val* renderable,
    const UsdGeomMesh& mesh,
    const MeshPayload& payload,
    const std::string& packageRootPath,
    UsdShadeMaterialBindingAPI::BindingsCache* bindingsCache,
    UsdShadeMaterialBindingAPI::CollectionQueryCache* collectionQueryCache)
{
    if (!renderable || !bindingsCache || !collectionQueryCache) {
        return;
    }

    const std::vector<MaterialSubsetGroup> materialGroups =
        _ExtractMaterialSubsetGroups(mesh, payload);
    if (materialGroups.empty()) {
        return;
    }

    emscripten::val materialSubsets = emscripten::val::array();
    for (size_t subsetIndex = 0; subsetIndex < materialGroups.size(); ++subsetIndex) {
        const MaterialSubsetGroup& group = materialGroups[subsetIndex];
        emscripten::val subset = emscripten::val::object();
        subset.set("path", group.prim.GetPath().GetString());
        subset.set("name", group.prim.GetName().GetString());
        subset.set("start", group.start);
        subset.set("count", group.count);
        subset.set(
            "material",
            _ExtractMaterial(
                group.prim,
                packageRootPath,
                bindingsCache,
                collectionQueryCache,
                (*renderable)["color"]));
        materialSubsets.set(subsetIndex, subset);
    }
    renderable->set("materialSubsets", materialSubsets);
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

// Read mesh points, converting half-precision (point3h[]) to float if needed.
static VtArray<GfVec3f>
_GetMeshPointsAsFloat(const UsdGeomMesh& mesh, UsdTimeCode timeCode)
{
    VtValue val;
    if (!mesh.GetPointsAttr().Get(&val, timeCode)) {
        return {};
    }
    if (val.IsHolding<VtArray<GfVec3f>>()) {
        return val.UncheckedGet<VtArray<GfVec3f>>();
    }
    if (val.IsHolding<VtArray<GfVec3h>>()) {
        const VtArray<GfVec3h>& half3 = val.UncheckedGet<VtArray<GfVec3h>>();
        VtArray<GfVec3f> result(half3.size());
        for (size_t i = 0; i < half3.size(); ++i) {
            result[i] = GfVec3f(
                float(half3[i][0]), float(half3[i][1]), float(half3[i][2]));
        }
        return result;
    }
    return {};
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
    VtArray<GfVec3f> usdPoints = _GetMeshPointsAsFloat(mesh, timeCode);
    VtArray<int> faceVertexCounts;
    VtArray<int> faceVertexIndices;

    if (usdPoints.empty() ||
        !mesh.GetFaceVertexCountsAttr().Get(&faceVertexCounts) ||
        !mesh.GetFaceVertexIndicesAttr().Get(&faceVertexIndices) ||
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
    payload->faceIndexStarts.reserve(faceVertexCounts.size());
    payload->faceIndexCounts.reserve(faceVertexCounts.size());
    for (int faceVertexCount : faceVertexCounts) {
        const int faceStart = static_cast<int>(payload->triangleIndices.size());
        if (faceVertexCount < 3 ||
            offset + static_cast<size_t>(faceVertexCount) > faceVertexIndices.size()) {
            offset += std::max(faceVertexCount, 0);
            payload->faceIndexStarts.push_back(faceStart);
            payload->faceIndexCounts.push_back(0);
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

        payload->faceIndexStarts.push_back(faceStart);
        payload->faceIndexCounts.push_back(
            static_cast<int>(payload->triangleIndices.size()) - faceStart);
        offset += faceVertexCount;
    }

    if (payload->uvs.size() != (payload->points.size() / 3) * 2) {
        payload->uvs.clear();
    }

    return !payload->triangleIndices.empty();
}

bool
_ExtractSkinnedControlPoints(
    const UsdGeomMesh& mesh,
    std::vector<float>* points,
    UsdTimeCode timeCode,
    const UsdSkelCache* skelCache,
    const UsdSkelSkeleton& skel,
    UsdGeomXformCache* xformCache)
{
    if (!points) {
        return false;
    }

    VtArray<GfVec3f> usdPoints = _GetMeshPointsAsFloat(mesh, timeCode);
    if (usdPoints.empty()) {
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

    points->clear();
    points->reserve(usdPoints.size() * 3);
    for (const GfVec3f& point : usdPoints) {
        points->push_back(point[0]);
        points->push_back(point[1]);
        points->push_back(point[2]);
    }
    return !points->empty();
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

// ---------------------------------------------------------------------------
// WebViewStageDriver (Phase 3): the single geometry authority.
//
// One driver per stage path, owned by the StageRecord. It composes a private
// driver stage — root layer shared with the inspection stage, plus an
// anonymous driver session layer that sublayers the inspection stage's
// session layer (so variant/payload edits propagate by composition).
// Skel-binding inference opinions and UsdSkelBakeSkinning output land only
// in the driver session; the shared stage is never mutated.
// ---------------------------------------------------------------------------

struct StageDriverCapabilities
{
    bool hasSkelContent = false;
    bool skelBindingsInferred = false;
    bool hasTimeVaryingPoints = false;
    bool hasTimeVaryingXforms = false;
    bool hasAnimationRange = false;
    bool hasPointInstancers = false;
    bool hasMaterialX = false;
    bool hasGaussianSplats = false;
};

class WebViewStageDriver
{
public:
    explicit WebViewStageDriver(std::string stagePath)
        : _stagePath(std::move(stagePath))
    {
        _inspectionStage = _GetOrOpenStage(_stagePath);
        if (!_inspectionStage) {
            return;
        }
        _driverSession = SdfLayer::CreateAnonymous(".usda");
        RebuildDriverStage();
        _timeCode = GetStartTimeCode();
    }

    bool IsValid() const { return bool(_driverStage); }

    void NotifyStageEdited()
    {
        if (_inspectionStage) {
            RebuildDriverStage();
        }
    }

    void SetTime(double timeCode) { _timeCode = timeCode; }

    double GetStartTimeCode() const
    {
        return _driverStage ? _driverStage->GetStartTimeCode() : 0.0;
    }

    double GetEndTimeCode() const
    {
        return _driverStage ? _driverStage->GetEndTimeCode() : 0.0;
    }

    double GetTimeCodesPerSecond() const
    {
        return _driverStage ? _driverStage->GetTimeCodesPerSecond() : 24.0;
    }

    emscripten::val GetCapabilities() const
    {
        emscripten::val caps = emscripten::val::object();
        caps.set("hasSkelContent", _capabilities.hasSkelContent);
        caps.set("skelBindingsInferred", _capabilities.skelBindingsInferred);
        caps.set("hasTimeVaryingPoints", _capabilities.hasTimeVaryingPoints);
        caps.set("hasTimeVaryingXforms", _capabilities.hasTimeVaryingXforms);
        caps.set("hasAnimationRange", _capabilities.hasAnimationRange);
        caps.set("hasPointInstancers", _capabilities.hasPointInstancers);
        caps.set("hasMaterialX", _capabilities.hasMaterialX);
        caps.set("hasGaussianSplats", _capabilities.hasGaussianSplats);
        return caps;
    }

    emscripten::val GetDiagnostics() const
    {
        emscripten::val info = emscripten::val::object();
        info.set("capabilities", GetCapabilities());
        info.set("inferredBindingCount", _inferredBindingCount);
        info.set("bakeTimeMs", _bakeTimeMs);
        info.set("rootLayerClean", _rootLayerCleanAfterBake);
        info.set("inspectionSessionClean", _inspectionSessionCleanAfterBake);
        std::string sessionText;
        if (_driverSession && _driverSession->ExportToString(&sessionText)) {
            info.set("driverSessionText", sessionText);
        }
        return info;
    }

    emscripten::val Draw(bool full)
    {
        return _Draw(full, SdfPath::AbsoluteRootPath());
    }

    emscripten::val DrawSubtree(const std::string& primPath)
    {
        return _Draw(true, SdfPath(primPath));
    }

private:
    void RebuildDriverStage()
    {
        _driverSession->Clear();
        _driverSession->SetSubLayerPaths(
            { _inspectionStage->GetSessionLayer()->GetIdentifier() });
        if (!_driverStage) {
            _driverStage = UsdStage::Open(
                _inspectionStage->GetRootLayer(), _driverSession);
        }
        if (!_driverStage) {
            return;
        }
        _driverStage->SetLoadRules(_inspectionStage->GetLoadRules());
        _driverStage->SetEditTarget(UsdEditTarget(_driverSession));
        _topologyByPath.clear();

        const bool sessionDirtyBefore =
            _inspectionStage->GetSessionLayer()->IsDirty();

        bool hasSkelContent = false;
        for (const UsdPrim& prim : _driverStage->Traverse()) {
            if (prim.IsA<UsdSkelRoot>()) {
                hasSkelContent = true;
                break;
            }
        }

        _inferredBindingCount = 0;
        _bakeTimeMs = 0.0;
        if (hasSkelContent) {
            LegacySkelBindingAuthoringDiagnostics inferenceDiagnostics;
            _inferredBindingCount = _AuthorInferredSkelBindingTargetsToLayer(
                _driverStage, _driverSession, &inferenceDiagnostics);

            // UsdSkelBakeSkinning resolves bindings through
            // ComputeSkelBindings, which requires SkelBindingAPI to be
            // applied — inferred relationships alone are not enough. Apply
            // it (into the driver session via the edit target) wherever a
            // skel:skeleton relationship is composed without the schema.
            for (const UsdPrim& prim : _driverStage->Traverse()) {
                if (prim.HasAPI<UsdSkelBindingAPI>()) {
                    continue;
                }
                auto hasRelTargets = [&prim](const TfToken& relName) {
                    UsdRelationship rel = prim.GetRelationship(relName);
                    SdfPathVector targets;
                    return rel && rel.GetTargets(&targets) && !targets.empty();
                };
                if (hasRelTargets(UsdSkelTokens->skelSkeleton) ||
                    hasRelTargets(UsdSkelTokens->skelAnimationSource)) {
                    UsdSkelBindingAPI::Apply(prim);
                }
            }

            const auto bakeStart = std::chrono::steady_clock::now();
            UsdSkelBakeSkinning(_driverStage->Traverse());
            _bakeTimeMs = std::chrono::duration<double, std::milli>(
                std::chrono::steady_clock::now() - bakeStart).count();
        }
        _rootLayerCleanAfterBake = !_inspectionStage->GetRootLayer()->IsDirty();
        _inspectionSessionCleanAfterBake =
            _inspectionStage->GetSessionLayer()->IsDirty() == sessionDirtyBefore;

        _ComputeCapabilities(hasSkelContent);
    }

    void _ComputeCapabilities(bool hasSkelContent)
    {
        _capabilities = StageDriverCapabilities();
        _capabilities.hasSkelContent = hasSkelContent;
        _capabilities.skelBindingsInferred = _inferredBindingCount > 0;
        _capabilities.hasAnimationRange =
            _driverStage->GetEndTimeCode() > _driverStage->GetStartTimeCode();

        static const TfToken kSplatType("ParticleField3DGaussianSplat");
        for (const UsdPrim& prim : _driverStage->Traverse()) {
            if (prim.GetTypeName() == kSplatType) {
                _capabilities.hasGaussianSplats = true;
            }
            if (prim.IsA<UsdGeomPointInstancer>()) {
                _capabilities.hasPointInstancers = true;
            }
            if (prim.IsA<UsdGeomMesh>()) {
                UsdGeomMesh mesh(prim);
                UsdAttribute pointsAttr = mesh.GetPointsAttr();
                if (pointsAttr && pointsAttr.GetNumTimeSamples() > 1) {
                    _capabilities.hasTimeVaryingPoints = true;
                }
                UsdGeomXformable xformable(prim);
                if (xformable) {
                    bool resetsStack = false;
                    for (const UsdGeomXformOp& op :
                         xformable.GetOrderedXformOps(&resetsStack)) {
                        if (op.GetNumTimeSamples() > 1) {
                            _capabilities.hasTimeVaryingXforms = true;
                            break;
                        }
                    }
                }
            }
            if (prim.IsA<UsdShadeShader>()) {
                SdfAssetPath sourceAsset;
                TfToken subIdentifier;
                if (_GetMaterialXSourceAsset(
                        UsdShadeShader(prim), &sourceAsset, &subIdentifier)) {
                    _capabilities.hasMaterialX = true;
                }
            }
        }
    }

    struct TriangulatedTopology
    {
        VtVec3iArray triangleIndices;
        VtIntArray primitiveParams;
        VtIntArray faceVertexCounts;
        VtIntArray faceVertexIndices;
        size_t pointBasis = 0;
    };

    const TriangulatedTopology* _GetTopology(const UsdGeomMesh& mesh)
    {
        const std::string path = mesh.GetPath().GetString();
        auto it = _topologyByPath.find(path);
        if (it != _topologyByPath.end()) {
            return &it->second;
        }

        TriangulatedTopology topo;
        mesh.GetFaceVertexCountsAttr().Get(&topo.faceVertexCounts);
        mesh.GetFaceVertexIndicesAttr().Get(&topo.faceVertexIndices);
        if (topo.faceVertexCounts.empty() || topo.faceVertexIndices.empty()) {
            return nullptr;
        }
        HdMeshTopology topology(
            PxOsdOpenSubdivTokens->none,
            HdTokens->rightHanded,
            topo.faceVertexCounts,
            topo.faceVertexIndices);
        HdMeshUtil meshUtil(&topology, mesh.GetPath());
        meshUtil.ComputeTriangleIndices(
            &topo.triangleIndices, &topo.primitiveParams);
        if (topo.triangleIndices.empty()) {
            return nullptr;
        }
        auto inserted = _topologyByPath.emplace(path, std::move(topo));
        return &inserted.first->second;
    }

    // Sample a vec3f/vec2f primvar and return per-triangle-corner expanded
    // floats, honoring faceVarying / vertex / uniform / constant interpolation.
    template <typename VecType>
    bool _ExpandPrimvarToCorners(
        const UsdGeomPrimvar& primvar,
        const TriangulatedTopology& topo,
        const std::vector<int>& triangleOrder,
        UsdTimeCode timeCode,
        int components,
        std::vector<float>* out) const
    {
        VtArray<VecType> values;
        if (!primvar || !primvar.ComputeFlattened(&values, timeCode) ||
            values.empty()) {
            return false;
        }
        const TfToken interpolation = primvar.GetInterpolation();
        const size_t cornerCount = topo.triangleIndices.size() * 3;
        out->clear();
        out->reserve(cornerCount * components);

        auto pushValue = [&](size_t index) {
            const VecType& v = values[std::min(index, values.size() - 1)];
            for (int c = 0; c < components; ++c) {
                out->push_back(float(v[c]));
            }
        };

        if (interpolation == UsdGeomTokens->faceVarying) {
            // Triangulate authored-corner data with HdMeshUtil so corner
            // order matches ComputeTriangleIndices.
            HdMeshTopology topology(
                PxOsdOpenSubdivTokens->none,
                HdTokens->rightHanded,
                topo.faceVertexCounts,
                topo.faceVertexIndices);
            HdMeshUtil meshUtil(&topology, SdfPath::AbsoluteRootPath());
            VtValue triangulated;
            if (meshUtil.ComputeTriangulatedFaceVaryingPrimvar(
                    values.cdata(),
                    static_cast<int>(values.size()),
                    components == 2 ? HdTypeFloatVec2 : HdTypeFloatVec3,
                    &triangulated) != HdMeshComputationResult::Success) {
                return false;
            }
            const VtArray<VecType> cornerValues =
                triangulated.Get<VtArray<VecType>>();
            for (int tri : triangleOrder) {
                for (int corner = 0; corner < 3; ++corner) {
                    const size_t index = std::min(
                        size_t(tri) * 3 + corner, cornerValues.size() - 1);
                    const VecType& v = cornerValues[index];
                    for (int c = 0; c < components; ++c) {
                        out->push_back(float(v[c]));
                    }
                }
            }
            return true;
        }

        if (interpolation == UsdGeomTokens->vertex ||
            interpolation == UsdGeomTokens->varying) {
            for (int tri : triangleOrder) {
                const GfVec3i& triangle = topo.triangleIndices[tri];
                for (int corner = 0; corner < 3; ++corner) {
                    pushValue(size_t(triangle[corner]));
                }
            }
            return true;
        }

        if (interpolation == UsdGeomTokens->uniform) {
            for (int tri : triangleOrder) {
                const size_t face = size_t(HdMeshUtil::DecodeFaceIndexFromCoarseFaceParam(
                    topo.primitiveParams[tri]));
                for (int corner = 0; corner < 3; ++corner) {
                    pushValue(face);
                }
            }
            return true;
        }

        // constant
        for (size_t i = 0; i < topo.triangleIndices.size() * 3; ++i) {
            pushValue(0);
        }
        return true;
    }

    emscripten::val _Draw(bool full, const SdfPath& rootPath)
    {
        // Typed-array views point into these buffers; they stay valid until
        // the next Draw/DrawSubtree call, by which time the JS consumer has
        // copied them into its own geometry attributes.
        _drawBuffers.clear();
        emscripten::val result = emscripten::val::object();
        emscripten::val meshes = emscripten::val::array();
        size_t meshIndex = 0;
        if (!_driverStage) {
            result.set("meshes", meshes);
            return result;
        }

        const UsdTimeCode timeCode(_timeCode);
        UsdGeomXformCache xformCache(timeCode);
        UsdShadeMaterialBindingAPI::BindingsCache bindingsCache;
        UsdShadeMaterialBindingAPI::CollectionQueryCache collectionQueryCache;
        const std::vector<SdfPath> instancerPrototypeRoots =
            _CollectPointInstancerPrototypeRoots(_driverStage);

        for (const UsdPrim& prim : _driverStage->Traverse()) {
            if (!prim.IsA<UsdGeomMesh>()) {
                continue;
            }
            if (rootPath != SdfPath::AbsoluteRootPath() &&
                !prim.GetPath().HasPrefix(rootPath)) {
                continue;
            }
            if (_PathHasPrefixInList(prim.GetPath(), instancerPrototypeRoots)) {
                continue;
            }
            UsdGeomImageable imageable(prim);
            if (imageable.ComputeVisibility(timeCode) ==
                UsdGeomTokens->invisible) {
                continue;
            }
            const TfToken purpose = imageable.ComputePurpose();
            if (purpose != UsdGeomTokens->default_ &&
                purpose != UsdGeomTokens->render) {
                continue;
            }

            UsdGeomMesh mesh(prim);
            UsdAttribute pointsAttr = mesh.GetPointsAttr();
            const bool pointsVary =
                pointsAttr && pointsAttr.GetNumTimeSamples() > 1;
            if (!full && !pointsVary) {
                continue;
            }

            emscripten::val entry =
                _BuildMeshEntry(mesh, timeCode, xformCache,
                                bindingsCache, collectionQueryCache);
            if (!entry.isUndefined()) {
                meshes.set(meshIndex++, entry);
            }
        }

        // Point instancers reuse the legacy extraction path; entries carry
        // points+indices (unexpanded) and instanceMatrices, which the TS
        // consumer expands.
        if (full || _capabilities.hasPointInstancers) {
            const std::string packageRootPath =
                _GetLayerIdentifier(_driverStage->GetRootLayer());
            _AppendPointInstancerRenderablesAtTime(
                &meshes,
                &meshIndex,
                _stagePath,
                _driverStage,
                packageRootPath,
                timeCode,
                /* includeMaterials = */ false,
                rootPath,
                instancerPrototypeRoots,
                /* skelCache = */ nullptr,
                &bindingsCache,
                &collectionQueryCache);
        }

        result.set("meshes", meshes);
        return result;
    }

    emscripten::val _BuildMeshEntry(
        const UsdGeomMesh& mesh,
        UsdTimeCode timeCode,
        UsdGeomXformCache& xformCache,
        UsdShadeMaterialBindingAPI::BindingsCache& bindingsCache,
        UsdShadeMaterialBindingAPI::CollectionQueryCache& collectionQueryCache)
    {
        const TriangulatedTopology* topo = _GetTopology(mesh);
        if (!topo) {
            return emscripten::val::undefined();
        }
        VtArray<GfVec3f> points = _GetMeshPointsAsFloat(mesh, timeCode);
        if (points.empty()) {
            return emscripten::val::undefined();
        }

        const UsdPrim prim = mesh.GetPrim();
        emscripten::val entry = emscripten::val::object();
        entry.set("path", prim.GetPath().GetString());
        entry.set("name", prim.GetName().GetString());

        // Subset-aware triangle emission order: group triangles per bound
        // GeomSubset so material groups are contiguous [start,count) ranges.
        const size_t triangleCount = topo->triangleIndices.size();
        std::vector<int> triangleOrder(triangleCount);
        for (size_t i = 0; i < triangleCount; ++i) {
            triangleOrder[i] = int(i);
        }

        emscripten::val subsets = emscripten::val::array();
        bool hasSubsets = false;
        {
            const std::vector<UsdGeomSubset> geomSubsets =
                UsdGeomSubset::GetGeomSubsets(
                    UsdGeomImageable(prim),
                    UsdGeomTokens->face,
                    TfToken("materialBind"));
            if (!geomSubsets.empty()) {
                // face index -> subset slot (last one wins, like Hydra)
                std::unordered_map<int, int> subsetByFace;
                for (size_t s = 0; s < geomSubsets.size(); ++s) {
                    VtIntArray faceIndices;
                    geomSubsets[s].GetIndicesAttr().Get(&faceIndices, timeCode);
                    for (int face : faceIndices) {
                        subsetByFace[face] = int(s);
                    }
                }
                // stable partition triangles: subset 0..n-1, then unassigned
                std::vector<std::vector<int>> bySlot(geomSubsets.size() + 1);
                for (size_t tri = 0; tri < triangleCount; ++tri) {
                    const int face =
                        HdMeshUtil::DecodeFaceIndexFromCoarseFaceParam(
                            topo->primitiveParams[tri]);
                    auto slotIt = subsetByFace.find(face);
                    bySlot[slotIt == subsetByFace.end()
                        ? geomSubsets.size()
                        : size_t(slotIt->second)].push_back(int(tri));
                }
                triangleOrder.clear();
                size_t subsetIndex = 0;
                for (size_t s = 0; s < geomSubsets.size(); ++s) {
                    if (bySlot[s].empty()) {
                        continue;
                    }
                    emscripten::val subset = emscripten::val::object();
                    subset.set("path", geomSubsets[s].GetPath().GetString());
                    subset.set("name", geomSubsets[s].GetPrim().GetName().GetString());
                    subset.set("start", int(triangleOrder.size() * 3));
                    subset.set("count", int(bySlot[s].size() * 3));
                    UsdShadeMaterialBindingAPI subsetBinding(
                        geomSubsets[s].GetPrim());
                    UsdShadeMaterial subsetMaterial =
                        subsetBinding.ComputeBoundMaterial(
                            &bindingsCache, &collectionQueryCache);
                    if (subsetMaterial) {
                        subset.set(
                            "materialPath",
                            subsetMaterial.GetPath().GetString());
                    }
                    subsets.set(subsetIndex++, subset);
                    triangleOrder.insert(
                        triangleOrder.end(), bySlot[s].begin(), bySlot[s].end());
                    hasSubsets = true;
                }
                if (!bySlot.back().empty()) {
                    emscripten::val subset = emscripten::val::object();
                    subset.set("path", prim.GetPath().GetString());
                    subset.set("name", prim.GetName().GetString());
                    subset.set("start", int(triangleOrder.size() * 3));
                    subset.set("count", int(bySlot.back().size() * 3));
                    subsets.set(subsetIndex++, subset);
                    triangleOrder.insert(
                        triangleOrder.end(),
                        bySlot.back().begin(), bySlot.back().end());
                }
            }
        }

        // Positions: triangle-corner expanded.
        std::vector<float> positions;
        positions.reserve(triangleCount * 9);
        for (int tri : triangleOrder) {
            const GfVec3i& triangle = topo->triangleIndices[tri];
            for (int corner = 0; corner < 3; ++corner) {
                const size_t pointIndex = size_t(triangle[corner]);
                if (pointIndex >= points.size()) {
                    // skip-the-face error handling: emit a degenerate corner
                    positions.push_back(0);
                    positions.push_back(0);
                    positions.push_back(0);
                    continue;
                }
                const GfVec3f& p = points[pointIndex];
                positions.push_back(p[0]);
                positions.push_back(p[1]);
                positions.push_back(p[2]);
            }
        }
        _drawBuffers.push_back(std::move(positions));
        entry.set("positions", _Float32View(_drawBuffers.back()));

        // Normals: authored first (primvars:normals wins over normals attr),
        // natively computed smooth normals as fallback.
        std::vector<float> normals;
        bool haveNormals = false;
        UsdGeomPrimvarsAPI primvarsApi(prim);
        UsdGeomPrimvar normalsPrimvar =
            primvarsApi.GetPrimvar(TfToken("normals"));
        if (normalsPrimvar) {
            haveNormals = _ExpandPrimvarToCorners<GfVec3f>(
                normalsPrimvar, *topo, triangleOrder, timeCode, 3, &normals);
        }
        if (!haveNormals) {
            VtArray<GfVec3f> authoredNormals;
            if (mesh.GetNormalsAttr().Get(&authoredNormals, timeCode) &&
                !authoredNormals.empty()) {
                const TfToken interpolation = mesh.GetNormalsInterpolation();
                haveNormals = _ExpandValuesToCorners(
                    authoredNormals, interpolation, *topo, triangleOrder,
                    &normals);
            }
        }
        if (!haveNormals) {
            HdMeshTopology topology(
                PxOsdOpenSubdivTokens->none,
                HdTokens->rightHanded,
                topo->faceVertexCounts,
                topo->faceVertexIndices);
            Hd_VertexAdjacency adjacency;
            adjacency.BuildAdjacencyTable(&topology);
            VtArray<GfVec3f> smooth = Hd_SmoothNormals::ComputeSmoothNormals(
                &adjacency,
                static_cast<int>(points.size()),
                points.cdata());
            if (!smooth.empty()) {
                haveNormals = _ExpandValuesToCorners(
                    smooth, UsdGeomTokens->vertex, *topo, triangleOrder,
                    &normals);
            }
        }
        if (haveNormals) {
            _drawBuffers.push_back(std::move(normals));
            entry.set("normals", _Float32View(_drawBuffers.back()));
        }

        // UVs (primvars:st), same corner stream.
        std::vector<float> uvs;
        UsdGeomPrimvar stPrimvar = primvarsApi.GetPrimvar(TfToken("st"));
        if (stPrimvar &&
            _ExpandPrimvarToCorners<GfVec2f>(
                stPrimvar, *topo, triangleOrder, timeCode, 2, &uvs)) {
            _drawBuffers.push_back(std::move(uvs));
            entry.set("uvs", _Float32View(_drawBuffers.back()));
        }

        entry.set(
            "matrix",
            _MatrixArray(xformCache.GetLocalToWorldTransform(prim)));

        VtArray<GfVec3f> displayColors;
        if (mesh.GetDisplayColorAttr().Get(&displayColors, timeCode) &&
            !displayColors.empty()) {
            entry.set("displayColor", _Vec3Array(displayColors[0]));
        }

        UsdShadeMaterial boundMaterial =
            UsdShadeMaterialBindingAPI(prim).ComputeBoundMaterial(
                &bindingsCache, &collectionQueryCache);
        if (!boundMaterial) {
            if (UsdPrim materialPrim =
                    _FindBoundMaterialPrimByAuthoredRelationships(prim)) {
                entry.set("materialPath", materialPrim.GetPath().GetString());
            }
        } else {
            entry.set("materialPath", boundMaterial.GetPath().GetString());
        }

        if (hasSubsets) {
            entry.set("subsets", subsets);
        }
        return entry;
    }

    bool _ExpandValuesToCorners(
        const VtArray<GfVec3f>& values,
        const TfToken& interpolation,
        const TriangulatedTopology& topo,
        const std::vector<int>& triangleOrder,
        std::vector<float>* out) const
    {
        out->clear();
        out->reserve(triangleOrder.size() * 9);
        auto push = [&](size_t index) {
            const GfVec3f& v = values[std::min(index, values.size() - 1)];
            out->push_back(v[0]);
            out->push_back(v[1]);
            out->push_back(v[2]);
        };

        if (interpolation == UsdGeomTokens->faceVarying) {
            HdMeshTopology topology(
                PxOsdOpenSubdivTokens->none,
                HdTokens->rightHanded,
                topo.faceVertexCounts,
                topo.faceVertexIndices);
            HdMeshUtil meshUtil(&topology, SdfPath::AbsoluteRootPath());
            VtValue triangulated;
            if (meshUtil.ComputeTriangulatedFaceVaryingPrimvar(
                    values.cdata(),
                    static_cast<int>(values.size()),
                    HdTypeFloatVec3,
                    &triangulated) != HdMeshComputationResult::Success) {
                return false;
            }
            const VtArray<GfVec3f> corners =
                triangulated.Get<VtArray<GfVec3f>>();
            for (int tri : triangleOrder) {
                for (int corner = 0; corner < 3; ++corner) {
                    const size_t index = std::min(
                        size_t(tri) * 3 + corner, corners.size() - 1);
                    const GfVec3f& v = corners[index];
                    out->push_back(v[0]);
                    out->push_back(v[1]);
                    out->push_back(v[2]);
                }
            }
            return true;
        }
        if (interpolation == UsdGeomTokens->vertex ||
            interpolation == UsdGeomTokens->varying) {
            for (int tri : triangleOrder) {
                const GfVec3i& triangle = topo.triangleIndices[tri];
                for (int corner = 0; corner < 3; ++corner) {
                    push(size_t(triangle[corner]));
                }
            }
            return true;
        }
        if (interpolation == UsdGeomTokens->uniform) {
            for (int tri : triangleOrder) {
                const size_t face = size_t(
                    HdMeshUtil::DecodeFaceIndexFromCoarseFaceParam(
                        topo.primitiveParams[tri]));
                for (int corner = 0; corner < 3; ++corner) {
                    push(face);
                }
            }
            return true;
        }
        for (size_t i = 0; i < triangleOrder.size() * 3; ++i) {
            push(0);
        }
        return true;
    }

    std::string _stagePath;
    UsdStageRefPtr _inspectionStage;
    UsdStageRefPtr _driverStage;
    SdfLayerRefPtr _driverSession;
    double _timeCode = 0.0;
    StageDriverCapabilities _capabilities;
    int _inferredBindingCount = 0;
    double _bakeTimeMs = 0.0;
    bool _rootLayerCleanAfterBake = true;
    bool _inspectionSessionCleanAfterBake = true;
    std::unordered_map<std::string, TriangulatedTopology> _topologyByPath;
    std::deque<std::vector<float>> _drawBuffers;
};

std::unordered_map<std::string, std::unique_ptr<WebViewStageDriver>>
    g_unifiedDrivers;

WebViewStageDriver*
_GetUnifiedDriver(const std::string& stagePath)
{
    auto it = g_unifiedDrivers.find(stagePath);
    return it != g_unifiedDrivers.end() ? it->second.get() : nullptr;
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

std::string
GetLastSkelBindingOverlayContents(const std::string& stagePath)
{
    auto it = g_stageRegistry.find(stagePath);
    return it == g_stageRegistry.end()
        ? std::string()
        : it->second.lastSkelBindingOverlayContents;
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
    const StageRecord& debugRecord = _GetStageRecord(stagePath);
    info.set(
        "authoredLegacySkelBindingTargetCount",
        debugRecord.authoredLegacySkelBindingTargets.value_or(0));
    if (debugRecord.legacySkelBindingDiagnostics.has_value()) {
        const LegacySkelBindingAuthoringDiagnostics& diag =
            *debugRecord.legacySkelBindingDiagnostics;
        info.set("legacyAuthorSkeletonPrims", diag.skeletonPrims);
        info.set("legacyAuthorAnimationTargets", diag.animationTargets);
        info.set("legacyAuthorMeshPrims", diag.meshPrims);
        info.set("legacyAuthorMeshSkinningQueries", diag.meshSkinningQueries);
        info.set("legacyAuthorMeshInferredSkeletons", diag.meshInferredSkeletons);
        info.set("legacyAuthorRelationshipSpecs", diag.relationshipSpecs);
        info.set("legacyAuthorRelationshipCreateAttempts", diag.relationshipCreateAttempts);
        info.set("legacyAuthorRelationshipCreateFailures", diag.relationshipCreateFailures);
        info.set("legacyAuthorFirstRelationshipFailurePath", diag.firstRelationshipFailurePath);
        info.set("legacyAuthorSessionLayerIdentifier", diag.sessionLayerIdentifier);
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
_ExtractRenderablesAtTime(
    const std::string& path,
    UsdTimeCode timeCode,
    bool includeMaterials,
    const SdfPath& rootPath = SdfPath::AbsoluteRootPath())
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
    const bool collectAll =
        rootPath == SdfPath::AbsoluteRootPath() || rootPath.IsEmpty();
    const std::vector<SdfPath> prototypeRoots =
        _CollectPointInstancerPrototypeRoots(stage);

    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot())) {
        if (!prim.IsA<UsdGeomMesh>()) {
            continue;
        }
        if (_PathHasPrefixInList(prim.GetPath(), prototypeRoots)) {
            continue;
        }
        if (!collectAll &&
            prim.GetPath() != rootPath &&
            !prim.GetPath().HasPrefix(rootPath)) {
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
            _MaybeSetRenderableMaterialSubsets(
                &renderable,
                mesh,
                payload,
                packageRootPath,
                &bindingsCache,
                &collectionQueryCache);
        }
        renderables.set(renderableIndex++, renderable);
    }

    _AppendPointInstancerRenderablesAtTime(
        &renderables,
        &renderableIndex,
        path,
        stage,
        packageRootPath,
        timeCode,
        includeMaterials,
        rootPath,
        prototypeRoots,
        skelCache,
        &bindingsCache,
        &collectionQueryCache);

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
ExtractRenderablesWithMaterialsUnderRoot(
    const std::string& path,
    const std::string& primPath)
{
    UsdStageRefPtr stage = _GetOrOpenStage(path);
    return _ExtractRenderablesAtTime(
        path,
        stage ? UsdTimeCode(stage->GetStartTimeCode()) : UsdTimeCode::Default(),
        true,
        SdfPath(primPath));
}

emscripten::val
ExtractRenderablesAtTime(const std::string& path, double timeCode)
{
    return _ExtractRenderablesAtTime(path, UsdTimeCode(timeCode), false);
}

emscripten::val
OpenStage(const std::string& path, bool loadAllPayloads = true)
{
    _InvalidateDerivedStageCaches(path);
    g_stageRegistry.erase(path);
    UsdStageRefPtr stage = _GetOrOpenStage(path, loadAllPayloads);
    if (!stage) {
        return _ErrorResult(path, "Unable to open USD stage");
    }

    emscripten::val result = emscripten::val::object();
    result.set("rootFile", path);
    result.set("rootLayerIdentifier", _GetLayerIdentifier(stage->GetRootLayer()));
    result.set("primCount", _CountPrims(stage));
    result.set("layerCount", static_cast<int>(stage->GetUsedLayers().size()));
    const StageAuthoredStats stats = _CollectStageAuthoredStats(stage);
    result.set("meshPrimCount", stats.meshPrimCount);
    result.set("authoredPointCount", stats.authoredPointCount);
    result.set("authoredFaceCount", stats.authoredFaceCount);
    result.set("materialPrimCount", stats.materialPrimCount);
    result.set("materialBindingCount", stats.materialBindingCount);
    result.set("textureAssetCount", stats.textureAssetCount);
    result.set("payloadPrimCount", stats.payloadPrimCount);
    result.set("variantSetCount", stats.variantSetCount);
    result.set("instancePrimCount", stats.instancePrimCount);
    result.set("timeCodesPerSecond", stage->GetTimeCodesPerSecond());
    result.set("startTimeCode", stage->GetStartTimeCode());
    result.set("endTimeCode", stage->GetEndTimeCode());
    result.set("upAxis", UsdGeomGetStageUpAxis(stage).GetString());
    emscripten::val environment = _ExtractStageEnvironment(stage);
    if (!environment.isUndefined()) {
        result.set("environment", environment);
    }
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
                item.set("valueIsArray", true);
                item.set("valueElementCount", value.GetArraySize());
                if (!_FormatVtArrayPreview(value, &str)) {
                    str = "[" + std::to_string(value.GetArraySize()) + " elements]";
                }
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

    auto registryIt = g_stageRegistry.find(stagePath);
    const bool hasCachedStage =
        registryIt != g_stageRegistry.end() && registryIt->second.stage;
    if (layer && hasCachedStage) {
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
    StageRecord& record = _GetStageRecord(stagePath);
    record.stage.Reset();
    UsdStageRefPtr newStage =
        _OpenStageWithPayloadPolicy(stagePath, record.loadAllPayloadsOnOpen);
    if (!newStage) return false;
    record.stage = newStage;
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
    if (vs.GetVariantSelection() == selection) return true;

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
    const UsdPrim prim = stage->GetPrimAtPath(path);
    if (!prim) return false;
    if (prim.IsLoaded() == loaded) return true;

    if (loaded) {
        stage->Load(path);
    } else {
        stage->Unload(path);
    }
    _InvalidateDerivedStageCaches(stagePath);
    const UsdPrim updatedPrim = stage->GetPrimAtPath(path);
    return updatedPrim && updatedPrim.IsLoaded() == loaded;
}

void
SetAllPayloadsLoaded(const std::string& stagePath, bool loaded)
{
    UsdStageRefPtr stage = _GetOrOpenStage(stagePath);
    if (!stage) return;

    const auto traversePredicate =
        UsdPrimIsActive && UsdPrimIsDefined && !UsdPrimIsAbstract;
    SdfPathSet loadSet;
    SdfPathSet unloadSet;

    for (const UsdPrim& prim : UsdPrimRange(stage->GetPseudoRoot(), traversePredicate)) {
        if (prim.HasPayload()) {
            if (loaded) {
                loadSet.insert(prim.GetPath());
            } else {
                unloadSet.insert(prim.GetPath());
            }
        }
    }
    if (loadSet.empty() && unloadSet.empty()) return;
    stage->LoadAndUnload(loadSet, unloadSet);
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
    StageRecord& record = _GetStageRecord(stagePath);
    if (record.hydraAnimationDriver) {
        return record.hydraAnimationDriver.get();
    }

    UsdStageRefPtr stage = _GetOrOpenStage(stagePath);
    if (!stage) {
        return nullptr;
    }

    record.skelCache.reset();
    record.hasSkelRoot.reset();
    record.skinningSkeletonByPrim.clear();
    UsdStageRefPtr driverStage = stage;
    LegacySkelBindingAuthoringDiagnostics overlayDiagnostics;
    if (UsdStageRefPtr overlayStage =
            _CreateSkelBindingOverlayStage(
                stagePath,
                stage,
                &overlayDiagnostics)) {
        driverStage = overlayStage;
        record.authoredLegacySkelBindingTargets =
            overlayDiagnostics.relationshipSpecs;
        record.legacySkelBindingDiagnostics = overlayDiagnostics;
        record.skelCache.reset();
        record.hasSkelRoot.reset();
        record.skinningSkeletonByPrim.clear();
        _GetOrPopulateSkelCache(stagePath, driverStage);
    }
    auto driver = std::make_unique<HydraAnimationDriver>(
        stagePath,
        driverStage);
    HydraAnimationDriver* ptr = driver.get();
    record.hydraAnimationDriver = std::move(driver);
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
    update->expandedToFaceVertices = true;
    return true;
}

void
_SyncHydraDriverAtTime(HydraAnimationDriver* driver, double timeCode)
{
    if (!driver || !driver->renderIndex) {
        return;
    }

    driver->collector.Clear();
    if (driver->sceneIndices.stageSceneIndex) {
        driver->sceneIndices.stageSceneIndex->SetTime(
            UsdTimeCode(timeCode),
            /* forceDirtyingTimeDeps = */ true);
        driver->sceneIndices.stageSceneIndex->ApplyPendingUpdates();

        _SyncHydraRenderIndexGeometry(driver->renderIndex.get());
        if (driver->collector.updates.empty()) {
            for (const SdfPath& id : driver->renderIndex->GetRprimIds()) {
                HydraMeshUpdate update;
                if (_BuildHydraMeshUpdate(
                        driver->renderIndex.get(),
                        id,
                        &update)) {
                    driver->collector.Record(std::move(update));
                }
            }
        }
        return;
    }

    if (driver->imagingDelegate) {
        driver->imagingDelegate->SetTime(UsdTimeCode(timeCode));

        // Match the working web viewers: SetTime() dirties transforms, then
        // Draw() lets UsdImaging/Hydra decide which primvars also changed.
        HdChangeTracker& tracker =
            driver->renderIndex->GetChangeTracker();
        for (const SdfPath& primPath : driver->renderIndex->GetRprimIds()) {
            tracker.MarkRprimDirty(
                primPath,
                HdChangeTracker::DirtyTransform);
        }

        driver->imagingDelegate->ApplyPendingUpdates();
        HdTaskSharedPtrVector tasks = {
            std::make_shared<WebViewHydraSyncTask>(
                driver->geometryPass,
                driver->renderTags)
        };
        driver->engine.Execute(
            &driver->imagingDelegate->GetRenderIndex(),
            &tasks);
    }

    if (driver->collector.updates.empty()) {
        for (const SdfPath& id : driver->renderIndex->GetRprimIds()) {
            HydraMeshUpdate update;
            if (_BuildHydraMeshUpdate(
                    driver->renderIndex.get(),
                    id,
                    &update)) {
                driver->collector.Record(std::move(update));
            }
        }
    }
}

emscripten::val
_HydraCollectorUpdatesToRenderableArray(
    const std::string& stagePath,
    HydraAnimationDriver* driver,
    double timeCode)
{
    emscripten::val result = emscripten::val::array();
    if (!driver || !driver->stage) {
        return result;
    }

    UsdShadeMaterialBindingAPI::BindingsCache bindingsCache;
    UsdShadeMaterialBindingAPI::CollectionQueryCache collectionQueryCache;
    std::string packageRootPath = _GetLayerIdentifier(driver->stage->GetRootLayer());
    if (ArIsPackageRelativePath(packageRootPath)) {
        const size_t bracketPos = packageRootPath.find('[');
        if (bracketPos != std::string::npos) {
            packageRootPath = packageRootPath.substr(0, bracketPos);
        }
    }
    const std::vector<SdfPath> prototypeRoots =
        _CollectPointInstancerPrototypeRoots(driver->stage);
    UsdSkelCache* skelCache =
        _GetOrPopulateSkelCache(stagePath, driver->stage);

    size_t index = 0;
    for (auto& entry : driver->collector.updates) {
        HydraMeshUpdate& update = entry.second;
        UsdPrim prim = driver->stage->GetPrimAtPath(SdfPath(update.path));
        if (!prim || !prim.IsA<UsdGeomMesh>()) {
            continue;
        }
        if (_PathHasPrefixInList(prim.GetPath(), prototypeRoots)) {
            continue;
        }
        if (!update.expandedToFaceVertices) {
            _ExpandHydraUpdateToFaceVertices(
                driver->stage,
                prim.GetPath(),
                UsdTimeCode(timeCode),
                &update);
        }

        emscripten::val renderable = emscripten::val::object();
        renderable.set("path", update.path);
        renderable.set("name", update.name);
        renderable.set("points", _FloatArray(update.points));
        renderable.set("indices", _IntArray(update.triangleIndices));
        if (!update.uvs.empty()) {
            renderable.set("uvs", _FloatArray(update.uvs));
        }
        renderable.set("matrix", _MatrixArray(update.matrix));
        emscripten::val fallbackColor = _ColorArray(UsdGeomMesh(prim));
        renderable.set("color", fallbackColor);
        emscripten::val material = _ExtractMaterial(
            prim,
            packageRootPath,
            &bindingsCache,
            &collectionQueryCache,
            fallbackColor);
        renderable.set("material", material);
        const bool isSkinnedHydraRenderable =
            update.pointComputationCount > 0 ||
            update.usedComputedPoints ||
            update.sceneIndexHasSkelRoot ||
            !update.sceneIndexSkeletonPath.empty() ||
            update.usdSkelFallbackAvailable;
        if (!isSkinnedHydraRenderable) {
            MeshPayload subsetPayload;
            if (_BuildTriangulatedFaceIndexRuns(
                    UsdGeomMesh(prim),
                    &subsetPayload.faceIndexStarts,
                    &subsetPayload.faceIndexCounts)) {
                _MaybeSetRenderableMaterialSubsets(
                    &renderable,
                    UsdGeomMesh(prim),
                    subsetPayload,
                    packageRootPath,
                    &bindingsCache,
                    &collectionQueryCache);
            }
        }
        renderable.set("pointComputationCount", update.pointComputationCount);
        renderable.set("sceneIndexChildCount", update.sceneIndexChildCount);
        renderable.set("sceneIndexHasSkelRoot", update.sceneIndexHasSkelRoot);
        renderable.set("dirtyBits", static_cast<int>(update.dirtyBits));
        renderable.set("dirtyPoints", update.dirtyPoints);
        renderable.set("dirtyTransform", update.dirtyTransform);
        renderable.set("dirtyTopology", update.dirtyTopology);
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
        renderable.set("sceneIndexPrimType", update.sceneIndexPrimType);
        renderable.set("sceneIndexExtComputationPrimvarCount", update.sceneIndexExtComputationPrimvarCount);
        renderable.set("sceneIndexHasComputedPointsPrimvar", update.sceneIndexHasComputedPointsPrimvar);
        renderable.set("sceneIndexComputedPointsSourcePath", update.sceneIndexComputedPointsSourcePath);
        renderable.set("sceneIndexComputedPointsOutputName", update.sceneIndexComputedPointsOutputName);
        renderable.set("hydraCreatedMeshRprimCount", driver->collector.diagnostics.createdMeshRprims);
        renderable.set("hydraCreatedExtComputationCount", driver->collector.diagnostics.createdExtComputations);
        renderable.set("hydraCreatedMaterialCount", driver->collector.diagnostics.createdMaterials);
        renderable.set("usedComputedPoints", update.usedComputedPoints);
        renderable.set("usdSkelFallbackAvailable", update.usdSkelFallbackAvailable);
        result.set(index++, renderable);
    }

    _AppendPointInstancerRenderablesAtTime(
        &result,
        &index,
        stagePath,
        driver->stage,
        packageRootPath,
        UsdTimeCode(timeCode),
        true,
        SdfPath::AbsoluteRootPath(),
        prototypeRoots,
        skelCache,
        &bindingsCache,
        &collectionQueryCache);

    return result;
}

void
_CollectHydraRprims(
    HydraAnimationDriver* driver,
    const SdfPath& rootPath = SdfPath::AbsoluteRootPath())
{
    if (!driver || !driver->renderIndex) {
        return;
    }

    const bool collectAll =
        rootPath == SdfPath::AbsoluteRootPath() || rootPath.IsEmpty();
    driver->collector.Clear();
    for (const SdfPath& id : driver->renderIndex->GetRprimIds()) {
        if (!collectAll && id != rootPath && !id.HasPrefix(rootPath)) {
            continue;
        }
        HydraMeshUpdate update;
        if (_BuildHydraMeshUpdate(
                driver->renderIndex.get(),
                id,
                &update)) {
            driver->collector.Record(std::move(update));
        }
    }
}

emscripten::val
ExtractHydraRenderablesAtTime(const std::string& stagePath, double timeCode)
{
    HydraAnimationDriver* driver = _GetOrCreateHydraAnimationDriver(stagePath);
    if (!driver || !driver->renderIndex) {
        return emscripten::val::array();
    }

    _SyncHydraDriverAtTime(driver, timeCode);
    return _HydraCollectorUpdatesToRenderableArray(stagePath, driver, timeCode);
}

emscripten::val
ExtractHydraRenderableSnapshotAtTime(const std::string& stagePath, double timeCode)
{
    HydraAnimationDriver* driver = _GetOrCreateHydraAnimationDriver(stagePath);
    if (!driver || !driver->renderIndex) {
        return emscripten::val::array();
    }

    _SyncHydraDriverAtTime(driver, timeCode);
    _CollectHydraRprims(driver);
    return _HydraCollectorUpdatesToRenderableArray(stagePath, driver, timeCode);
}

emscripten::val
ExtractHydraRenderableSubtreeAtTime(
    const std::string& stagePath,
    const std::string& primPath,
    double timeCode)
{
    HydraAnimationDriver* driver = _GetOrCreateHydraAnimationDriver(stagePath);
    if (!driver || !driver->renderIndex) {
        return emscripten::val::array();
    }

    _SyncHydraDriverAtTime(driver, timeCode);
    _CollectHydraRprims(driver, SdfPath(primPath));
    return _HydraCollectorUpdatesToRenderableArray(stagePath, driver, timeCode);
}

class WebViewHydraSyncDriver
{
public:
    explicit WebViewHydraSyncDriver(std::string stagePath)
        : _stagePath(std::move(stagePath))
    {
        if (UsdStageRefPtr stage = _GetOrOpenStage(_stagePath)) {
            _startTimeCode = stage->GetStartTimeCode();
            _endTimeCode = stage->GetEndTimeCode();
            _timeCodesPerSecond = stage->GetTimeCodesPerSecond();
            _timeCode = _startTimeCode;
        }
        // Construct the native Hydra state up front so first Draw() mostly
        // syncs time-varying data instead of also populating the stage.
        (void)_GetOrCreateHydraAnimationDriver(_stagePath);
    }

    void SetTime(double timeCode)
    {
        _timeCode = timeCode;
    }

    double GetStartTimeCode() const
    {
        return _startTimeCode;
    }

    double GetEndTimeCode() const
    {
        return _endTimeCode;
    }

    double GetTimeCodesPerSecond() const
    {
        return _timeCodesPerSecond;
    }

    emscripten::val Draw()
    {
        HydraAnimationDriver* driver = _GetOrCreateHydraAnimationDriver(_stagePath);
        if (!driver || !driver->renderIndex) {
            return emscripten::val::array();
        }

        _SyncHydraDriverAtTime(driver, _timeCode);
        return _HydraCollectorUpdatesToRenderableArray(
            _stagePath,
            driver,
            _timeCode);
    }

private:
    std::string _stagePath;
    double _timeCode = 0.0;
    double _startTimeCode = 0.0;
    double _endTimeCode = 0.0;
    double _timeCodesPerSecond = 24.0;
};

static int g_nextHydraSyncDriverId = 1;
static std::unordered_map<int, std::unique_ptr<WebViewHydraSyncDriver>>
    g_hydraSyncDrivers;
static int g_nextReferenceHydraDriverId = 1;
static std::unordered_map<int, std::unique_ptr<ReferenceHydraSyncDriver>>
    g_referenceHydraDrivers;

int
CreateHydraSyncDriver(const std::string& stagePath)
{
    const int id = g_nextHydraSyncDriverId++;
    g_hydraSyncDrivers[id] =
        std::make_unique<WebViewHydraSyncDriver>(stagePath);
    return id;
}

void
DeleteHydraSyncDriver(int driverId)
{
    g_hydraSyncDrivers.erase(driverId);
}

void
SetHydraSyncDriverTime(int driverId, double timeCode)
{
    auto it = g_hydraSyncDrivers.find(driverId);
    if (it != g_hydraSyncDrivers.end() && it->second) {
        it->second->SetTime(timeCode);
    }
}

double
GetHydraSyncDriverStartTimeCode(int driverId)
{
    auto it = g_hydraSyncDrivers.find(driverId);
    return it != g_hydraSyncDrivers.end() && it->second
        ? it->second->GetStartTimeCode()
        : 0.0;
}

double
GetHydraSyncDriverEndTimeCode(int driverId)
{
    auto it = g_hydraSyncDrivers.find(driverId);
    return it != g_hydraSyncDrivers.end() && it->second
        ? it->second->GetEndTimeCode()
        : 0.0;
}

double
GetHydraSyncDriverTimeCodesPerSecond(int driverId)
{
    auto it = g_hydraSyncDrivers.find(driverId);
    return it != g_hydraSyncDrivers.end() && it->second
        ? it->second->GetTimeCodesPerSecond()
        : 24.0;
}

emscripten::val
DrawHydraSyncDriver(int driverId)
{
    auto it = g_hydraSyncDrivers.find(driverId);
    if (it != g_hydraSyncDrivers.end() && it->second) {
        return it->second->Draw();
    }
    return emscripten::val::array();
}

int
CreateReferenceHydraDriver(
    const std::string& stagePath,
    emscripten::val renderInterface)
{
    const int id = g_nextReferenceHydraDriverId++;
    auto driver = std::make_unique<ReferenceHydraSyncDriver>(
        stagePath,
        std::move(renderInterface));
    if (!driver->IsValid()) {
        return 0;
    }
    g_referenceHydraDrivers[id] = std::move(driver);
    return id;
}

void
DeleteReferenceHydraDriver(int driverId)
{
    g_referenceHydraDrivers.erase(driverId);
}

void
SetReferenceHydraDriverTime(int driverId, double timeCode)
{
    auto it = g_referenceHydraDrivers.find(driverId);
    if (it != g_referenceHydraDrivers.end() && it->second) {
        it->second->SetTime(timeCode);
    }
}

void
DrawReferenceHydraDriver(int driverId)
{
    auto it = g_referenceHydraDrivers.find(driverId);
    if (it != g_referenceHydraDrivers.end() && it->second) {
        it->second->Draw();
    }
}

double
GetReferenceHydraDriverStartTimeCode(int driverId)
{
    auto it = g_referenceHydraDrivers.find(driverId);
    return it != g_referenceHydraDrivers.end() && it->second
        ? it->second->GetStartTimeCode()
        : 0.0;
}

double
GetReferenceHydraDriverEndTimeCode(int driverId)
{
    auto it = g_referenceHydraDrivers.find(driverId);
    return it != g_referenceHydraDrivers.end() && it->second
        ? it->second->GetEndTimeCode()
        : 0.0;
}

double
GetReferenceHydraDriverTimeCodesPerSecond(int driverId)
{
    auto it = g_referenceHydraDrivers.find(driverId);
    return it != g_referenceHydraDrivers.end() && it->second
        ? it->second->GetTimeCodesPerSecond()
        : 24.0;
}

void
CloseStage(const std::string& stagePath)
{
    // Drops the stage record (composed stage, skel caches, hydra animation
    // driver, overlay diagnostics) for a path. The JS wrapper pairs this with
    // unlinking the stage's MEMFS files.
    g_stageRegistry.erase(stagePath);
    g_unifiedDrivers.erase(stagePath);
}

// --- Unified stage driver bindings (Phase 3) ---

bool
CreateStageDriver(const std::string& stagePath)
{
    auto driver = std::make_unique<WebViewStageDriver>(stagePath);
    if (!driver->IsValid()) {
        return false;
    }
    g_unifiedDrivers[stagePath] = std::move(driver);
    return true;
}

void
DeleteStageDriver(const std::string& stagePath)
{
    g_unifiedDrivers.erase(stagePath);
}

void
StageDriverSetTime(const std::string& stagePath, double timeCode)
{
    if (WebViewStageDriver* driver = _GetUnifiedDriver(stagePath)) {
        driver->SetTime(timeCode);
    }
}

emscripten::val
StageDriverDraw(const std::string& stagePath, bool full)
{
    WebViewStageDriver* driver = _GetUnifiedDriver(stagePath);
    return driver ? driver->Draw(full) : emscripten::val::undefined();
}

emscripten::val
StageDriverDrawSubtree(const std::string& stagePath, const std::string& primPath)
{
    WebViewStageDriver* driver = _GetUnifiedDriver(stagePath);
    return driver ? driver->DrawSubtree(primPath) : emscripten::val::undefined();
}

emscripten::val
StageDriverGetTiming(const std::string& stagePath)
{
    emscripten::val timing = emscripten::val::object();
    if (WebViewStageDriver* driver = _GetUnifiedDriver(stagePath)) {
        timing.set("start", driver->GetStartTimeCode());
        timing.set("end", driver->GetEndTimeCode());
        timing.set("fps", driver->GetTimeCodesPerSecond());
    }
    return timing;
}

emscripten::val
StageDriverGetCapabilities(const std::string& stagePath)
{
    WebViewStageDriver* driver = _GetUnifiedDriver(stagePath);
    return driver ? driver->GetCapabilities() : emscripten::val::undefined();
}

emscripten::val
StageDriverGetDiagnostics(const std::string& stagePath)
{
    WebViewStageDriver* driver = _GetUnifiedDriver(stagePath);
    return driver ? driver->GetDiagnostics() : emscripten::val::undefined();
}

void
StageDriverNotifyStageEdited(const std::string& stagePath)
{
    if (WebViewStageDriver* driver = _GetUnifiedDriver(stagePath)) {
        driver->NotifyStageEdited();
    }
}

// Authored-material supplier: one entry per bound material prim, keyed by
// material path. Meshes and their GeomSubsets are walked with the same
// binding resolution the legacy extractor used; the legacy extraction stops
// being a mesh source once the unified driver supplies geometry.
emscripten::val
ExtractMaterialPayloads(const std::string& stagePath)
{
    emscripten::val payloads = emscripten::val::array();
    UsdStageRefPtr stage = _GetOrOpenStage(stagePath);
    if (!stage) {
        return payloads;
    }

    const std::string packageRootPath =
        _GetLayerIdentifier(stage->GetRootLayer());
    UsdShadeMaterialBindingAPI::BindingsCache bindingsCache;
    UsdShadeMaterialBindingAPI::CollectionQueryCache collectionQueryCache;
    const emscripten::val undefinedColor = emscripten::val::undefined();

    std::set<std::string> seenMaterialPaths;
    size_t payloadIndex = 0;
    auto appendMaterialFor = [&](const UsdPrim& bindingPrim) {
        emscripten::val material = _ExtractMaterial(
            bindingPrim,
            packageRootPath,
            &bindingsCache,
            &collectionQueryCache,
            undefinedColor);
        if (material.isUndefined() || material["path"].isUndefined()) {
            return;
        }
        const std::string materialPath =
            material["path"].as<std::string>();
        if (!seenMaterialPaths.insert(materialPath).second) {
            return;
        }
        emscripten::val entry = emscripten::val::object();
        entry.set("path", materialPath);
        entry.set("material", material);
        payloads.set(payloadIndex++, entry);
    };

    for (const UsdPrim& prim : stage->Traverse()) {
        if (prim.IsA<UsdGeomMesh>()) {
            appendMaterialFor(prim);
            for (const UsdGeomSubset& subset : UsdGeomSubset::GetGeomSubsets(
                     UsdGeomImageable(prim),
                     UsdGeomTokens->face,
                     TfToken("materialBind"))) {
                appendMaterialFor(subset.GetPrim());
            }
        }
    }
    return payloads;
}

// SPIKE (Phase 3 entry gates S1-S3) — removed when WebViewStageDriver lands.
emscripten::val
RunUnifiedDriverSpikes(const std::string& stagePath)
{
    emscripten::val result = emscripten::val::object();
    UsdStageRefPtr inspectionStage = _GetOrOpenStage(stagePath);
    if (!inspectionStage) {
        result.set("error", std::string("no stage"));
        return result;
    }

    // S2: an anonymous driver session layer sublayers the inspection stage's
    // (anonymous) session layer and composes its opinions.
    SdfLayerRefPtr driverSession = SdfLayer::CreateAnonymous(".usda");
    driverSession->SetSubLayerPaths(
        { inspectionStage->GetSessionLayer()->GetIdentifier() });
    UsdStageRefPtr driverStage =
        UsdStage::Open(inspectionStage->GetRootLayer(), driverSession);
    result.set("s2_driverStageOpened", bool(driverStage));
    if (!driverStage) {
        return result;
    }
    driverStage->SetLoadRules(inspectionStage->GetLoadRules());

    bool s2Composes = false;
    {
        UsdEditContext editContext(
            inspectionStage, inspectionStage->GetSessionLayer());
        UsdPrim inspectionRoot = inspectionStage->GetDefaultPrim();
        if (inspectionRoot) {
            static const TfToken kComment("comment");
            inspectionRoot.SetMetadata(kComment, std::string("spike-s2-probe"));
            UsdPrim driverRoot =
                driverStage->GetPrimAtPath(inspectionRoot.GetPath());
            std::string comment;
            s2Composes = driverRoot &&
                driverRoot.GetMetadata(kComment, &comment) &&
                comment == "spike-s2-probe";
            inspectionRoot.ClearMetadata(kComment);
        }
    }
    result.set("s2_sessionOpinionComposes", s2Composes);

    // S1: bake skinning with the edit target on the driver session; the
    // shared root layer and the inspection session layer must stay clean.
    driverStage->SetEditTarget(UsdEditTarget(driverSession));
    const bool rootDirtyBefore = inspectionStage->GetRootLayer()->IsDirty();
    const bool sessionDirtyBefore =
        inspectionStage->GetSessionLayer()->IsDirty();
    const bool bakeRan = UsdSkelBakeSkinning(driverStage->Traverse());
    result.set("s1_bakeRan", bakeRan);
    result.set(
        "s1_rootLayerCleanAfterBake",
        inspectionStage->GetRootLayer()->IsDirty() == rootDirtyBefore);
    result.set(
        "s1_inspectionSessionCleanAfterBake",
        inspectionStage->GetSessionLayer()->IsDirty() == sessionDirtyBefore);
    result.set("s1_driverSessionHasOpinions", !driverSession->IsEmpty());

    // Baked skinning must yield time-varying points on the driver stage while
    // the inspection stage's mesh stays at rest.
    for (const UsdPrim& prim : driverStage->Traverse()) {
        if (!prim.IsA<UsdGeomMesh>()) {
            continue;
        }
        UsdGeomMesh mesh(prim);
        VtArray<GfVec3f> pointsStart = _GetMeshPointsAsFloat(mesh, UsdTimeCode(1));
        VtArray<GfVec3f> pointsMid = _GetMeshPointsAsFloat(mesh, UsdTimeCode(24));
        bool moved = pointsStart.size() == pointsMid.size() && !pointsStart.empty();
        double maxDelta = 0.0;
        if (moved) {
            for (size_t i = 0; i < pointsStart.size(); ++i) {
                maxDelta = std::max(
                    maxDelta,
                    double((pointsStart[i] - pointsMid[i]).GetLength()));
            }
        }
        result.set("s1_bakedPointsMaxDelta", maxDelta);

        // S3: HdMeshUtil triangulation + Hd smooth normals from the linked
        // static hd library.
        VtIntArray faceVertexCounts;
        VtIntArray faceVertexIndices;
        mesh.GetFaceVertexCountsAttr().Get(&faceVertexCounts);
        mesh.GetFaceVertexIndicesAttr().Get(&faceVertexIndices);
        HdMeshTopology topology(
            PxOsdOpenSubdivTokens->none,
            HdTokens->rightHanded,
            faceVertexCounts,
            faceVertexIndices);
        const std::vector<int> triangles =
            _TriangulateHydraTopology(topology, prim.GetPath());
        result.set("s3_triangleIndexCount", static_cast<int>(triangles.size()));

        Hd_VertexAdjacency adjacency;
        adjacency.BuildAdjacencyTable(&topology);
        VtArray<GfVec3f> smoothNormals = Hd_SmoothNormals::ComputeSmoothNormals(
            &adjacency,
            static_cast<int>(pointsMid.size()),
            pointsMid.cdata());
        result.set(
            "s3_smoothNormalCount", static_cast<int>(smoothNormals.size()));
        break;
    }

    return result;
}

EMSCRIPTEN_BINDINGS(usdWebViewBindings)
{
    emscripten::function("InitializeRuntime", &InitializeRuntime);
    emscripten::function("CloseStage", &CloseStage);
    emscripten::function("RunUnifiedDriverSpikes", &RunUnifiedDriverSpikes);
    emscripten::function("CreateStageDriver", &CreateStageDriver);
    emscripten::function("DeleteStageDriver", &DeleteStageDriver);
    emscripten::function("StageDriverSetTime", &StageDriverSetTime);
    emscripten::function("StageDriverDraw", &StageDriverDraw);
    emscripten::function("StageDriverDrawSubtree", &StageDriverDrawSubtree);
    emscripten::function("StageDriverGetTiming", &StageDriverGetTiming);
    emscripten::function("StageDriverGetCapabilities", &StageDriverGetCapabilities);
    emscripten::function("StageDriverGetDiagnostics", &StageDriverGetDiagnostics);
    emscripten::function("StageDriverNotifyStageEdited", &StageDriverNotifyStageEdited);
    emscripten::function("ExtractMaterialPayloads", &ExtractMaterialPayloads);
    emscripten::function("CreateReferenceHydraDriver", &CreateReferenceHydraDriver);
    emscripten::function("DeleteReferenceHydraDriver", &DeleteReferenceHydraDriver);
    emscripten::function("SetReferenceHydraDriverTime", &SetReferenceHydraDriverTime);
    emscripten::function("DrawReferenceHydraDriver", &DrawReferenceHydraDriver);
    emscripten::function("GetReferenceHydraDriverStartTimeCode", &GetReferenceHydraDriverStartTimeCode);
    emscripten::function("GetReferenceHydraDriverEndTimeCode", &GetReferenceHydraDriverEndTimeCode);
    emscripten::function("GetReferenceHydraDriverTimeCodesPerSecond", &GetReferenceHydraDriverTimeCodesPerSecond);
    emscripten::function("CreateHydraSyncDriver", &CreateHydraSyncDriver);
    emscripten::function("DeleteHydraSyncDriver", &DeleteHydraSyncDriver);
    emscripten::function("SetHydraSyncDriverTime", &SetHydraSyncDriverTime);
    emscripten::function("DrawHydraSyncDriver", &DrawHydraSyncDriver);
    emscripten::function("GetHydraSyncDriverStartTimeCode", &GetHydraSyncDriverStartTimeCode);
    emscripten::function("GetHydraSyncDriverEndTimeCode", &GetHydraSyncDriverEndTimeCode);
    emscripten::function("GetHydraSyncDriverTimeCodesPerSecond", &GetHydraSyncDriverTimeCodesPerSecond);
    emscripten::function("GetRuntimeDiagnostics", &GetRuntimeDiagnostics);
    emscripten::function("GetLastSkelBindingOverlayContents", &GetLastSkelBindingOverlayContents);
    emscripten::function("InspectPrimRelationships", &InspectPrimRelationships);
    emscripten::function("GetSkelDebugInfo", &GetSkelDebugInfo);
    emscripten::function("ExtractRenderables", &ExtractRenderables);
    emscripten::function("ExtractRenderablesWithMaterials", &ExtractRenderablesWithMaterials);
    emscripten::function("ExtractRenderablesWithMaterialsUnderRoot", &ExtractRenderablesWithMaterialsUnderRoot);
    emscripten::function("ExtractRenderablesAtTime", &ExtractRenderablesAtTime);
    emscripten::function("ExtractHydraRenderablesAtTime", &ExtractHydraRenderablesAtTime);
    emscripten::function("ExtractHydraRenderableSnapshotAtTime", &ExtractHydraRenderableSnapshotAtTime);
    emscripten::function("ExtractHydraRenderableSubtreeAtTime", &ExtractHydraRenderableSubtreeAtTime);
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
