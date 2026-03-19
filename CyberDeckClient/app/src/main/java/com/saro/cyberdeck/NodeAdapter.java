package com.saro.cyberdeck;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.AlphaAnimation;
import android.view.animation.Animation;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.cardview.widget.CardView;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

/**
 * RecyclerView adapter for displaying discovered CyberDeck nodes.
 */
public class NodeAdapter extends RecyclerView.Adapter<NodeAdapter.NodeViewHolder> {

    private final List<CyberDeckNode> nodes = new ArrayList<>();
    private OnNodeClickListener clickListener;

    public interface OnNodeClickListener {
        void onNodeClick(CyberDeckNode node);
    }

    public void setOnNodeClickListener(OnNodeClickListener listener) {
        this.clickListener = listener;
    }

    public void updateNodes(List<CyberDeckNode> newNodes) {
        nodes.clear();
        nodes.addAll(newNodes);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public NodeViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_node, parent, false);
        return new NodeViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull NodeViewHolder holder, int position) {
        CyberDeckNode node = nodes.get(position);
        holder.bind(node);
    }

    @Override
    public int getItemCount() {
        return nodes.size();
    }

    class NodeViewHolder extends RecyclerView.ViewHolder {
        private final CardView cardView;
        private final TextView nameText;
        private final TextView ipText;
        private final TextView methodText;
        private final TextView statusText;
        private final View pulseDot;

        NodeViewHolder(@NonNull View itemView) {
            super(itemView);
            cardView = itemView.findViewById(R.id.nodeCard);
            nameText = itemView.findViewById(R.id.nodeName);
            ipText = itemView.findViewById(R.id.nodeIp);
            methodText = itemView.findViewById(R.id.nodeMethod);
            statusText = itemView.findViewById(R.id.nodeStatus);
            pulseDot = itemView.findViewById(R.id.pulseDot);
        }

        void bind(CyberDeckNode node) {
            nameText.setText(node.getDisplayName());
            ipText.setText(node.getUrl());
            methodText.setText("via " + node.getDiscoveryMethod());

            long agoSeconds = (System.currentTimeMillis() - node.getLastSeen()) / 1000;
            if (agoSeconds < 5) {
                statusText.setText("Just now");
            } else {
                statusText.setText(agoSeconds + "s ago");
            }

            // Pulse animation on the status dot
            AlphaAnimation pulse = new AlphaAnimation(0.3f, 1.0f);
            pulse.setDuration(800);
            pulse.setRepeatCount(Animation.INFINITE);
            pulse.setRepeatMode(Animation.REVERSE);
            pulseDot.startAnimation(pulse);

            cardView.setOnClickListener(v -> {
                if (clickListener != null) {
                    clickListener.onNodeClick(node);
                }
            });
        }
    }
}
